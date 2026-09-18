import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { envSlice, projectRoot } from "../config";
import { parseServiceAccountKey } from "./service-account";
import {
  parseClientConfig,
  type ClientConfig,
  type LoadedClientConfig,
} from "./types";

const optionalString = z.string().min(1).optional();

const configPathSchema = z.object({
  GOOGLE_ADS_CONFIG_PATH: z
    .string()
    .default("clients/google-ads/client.config.json"),
});

const adsEnvSchema = z.object({
  GOOGLE_ADS_SA_KEY_JSON: optionalString,
});

const llmEnvSchema = z.object({
  OPENROUTER_MODEL: z.string().default("anthropic/claude-sonnet-5"),
});

/**
 * Client config only — no Ads secrets. The dashboard should use this so
 * it boots when GOOGLE_ADS_SA_KEY_JSON is unset.
 */
export function loadClientConfig(configPath?: string): LoadedClientConfig {
  const env = envSlice(configPathSchema);
  const resolved = resolve(
    projectRoot(),
    configPath ?? env.GOOGLE_ADS_CONFIG_PATH,
  );
  const raw: unknown = JSON.parse(readFileSync(resolved, "utf8"));
  return parseClientConfig(raw);
}

export function warehouseSchema(client?: ClientConfig): string | null {
  const schema = (client ?? loadClientConfig()).metrics.googleAdsSchema.trim();
  return schema === "" ? null : schema;
}

export function adsCredentials(): { saKeyJson: string } | null {
  const env = envSlice(adsEnvSchema);
  const json = env.GOOGLE_ADS_SA_KEY_JSON;
  if (!json) return null;
  parseServiceAccountKey(json);
  return { saKeyJson: json };
}

export function relevanceModel(): string {
  return envSlice(llmEnvSchema).OPENROUTER_MODEL;
}
