import { GoogleAuth } from "google-auth-library";
import { adsCredentials } from "./config";
import { parseServiceAccountKey } from "./service-account";
import type { ClientConfig } from "./types";

// v19 sunset Feb 2026 — REST returns HTML 404. Current is v25.
const API_VERSION = "v25";
const SCOPE = "https://www.googleapis.com/auth/adwords";

export class AdsApiError extends Error {
  code?: "api_budget";

  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "AdsApiError";
  }
}

function budgetError(kind: "read" | "write"): AdsApiError {
  const error = new AdsApiError(`API ${kind} operation budget exhausted`);
  error.code = "api_budget";
  return error;
}

export type AdsClient = {
  search: <T>(query: string) => Promise<T[]>;
  mutate: (
    operations: unknown[],
    validateOnly: boolean,
  ) => Promise<{ resourceNames: string[] }>;
};

export async function createAdsClient(
  client: ClientConfig,
  maxOperations: number,
): Promise<AdsClient | null> {
  const creds = adsCredentials();
  if (!creds) return null;

  const auth = new GoogleAuth({
    credentials: parseServiceAccountKey(creds.saKeyJson),
    scopes: [SCOPE],
  });
  const customerId = client.google_ads.customer_id.replace(/-/g, "");
  const loginCustomerId = client.google_ads.login_customer_id.replace(
    /-/g,
    "",
  );
  let writesUsed = 0;
  let readsUsed = 0;

  const reserveWrite = (count: number): boolean => {
    if (writesUsed + count > maxOperations) return false;
    writesUsed += count;
    return true;
  };

  const reserveRead = (count: number): boolean => {
    if (readsUsed + count > maxOperations) return false;
    readsUsed += count;
    return true;
  };

  const headers = async (): Promise<Record<string, string>> => {
    const token = await auth.getAccessToken();
    if (!token) throw new AdsApiError("Google Ads access token was empty");
    return {
      Authorization: `Bearer ${token}`,
      "login-customer-id": loginCustomerId,
      "Content-Type": "application/json",
    };
  };

  const post = async (path: string, body: unknown): Promise<unknown> => {
    const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/${path}`;
    const response = await fetch(url, {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new AdsApiError(
        `Google Ads API ${response.status}: ${text.slice(0, 500)}`,
        response.status,
        text,
      );
    }
    return text ? (JSON.parse(text) as unknown) : {};
  };

  return {
    search: async <T>(query: string) => {
      const rows: T[] = [];
      let pageToken: string | undefined;
      do {
        if (!reserveRead(1)) {
          throw budgetError("read");
        }
        const payload = (await post("googleAds:search", {
          query,
          ...(pageToken ? { pageToken } : {}),
        })) as { results?: T[]; nextPageToken?: string };
        rows.push(...(payload.results ?? []));
        pageToken = payload.nextPageToken;
      } while (pageToken);
      return rows;
    },
    mutate: async (operations, validateOnly) => {
      if (!reserveWrite(Math.max(operations.length, 1))) {
        throw budgetError("write");
      }
      const payload = (await post("googleAds:mutate", {
        mutateOperations: operations,
        validateOnly,
      })) as { mutateOperationResponses?: Record<string, unknown>[] };
      return { resourceNames: resourceNamesFromMutate(payload) };
    },
  };
}

function resourceNameOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("resourceName" in value)) return null;
  const name = value.resourceName;
  return typeof name === "string" ? name : null;
}

function resourceNamesFromMutate(payload: {
  mutateOperationResponses?: Record<string, unknown>[];
}): string[] {
  const names: string[] = [];
  for (const row of payload.mutateOperationResponses ?? []) {
    const top = resourceNameOf(row);
    if (top) names.push(top);
    for (const value of Object.values(row)) {
      const nested = resourceNameOf(value);
      if (nested) names.push(nested);
    }
  }
  return [...new Set(names)];
}
