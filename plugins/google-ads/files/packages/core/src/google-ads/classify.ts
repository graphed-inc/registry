import type { ClientConfig } from "./types";

export type TermVerdict = {
  term: string;
  offIntent: boolean;
  confidence: number;
  reason: string;
};

type VerdictsPayload = {
  verdicts?: {
    term?: string;
    off_intent?: boolean;
    offIntent?: boolean;
    confidence?: number;
    reason?: string;
  }[];
};

export function parseClassifierContent(content: string): TermVerdict[] | null {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? trimmed).trim();
  try {
    const parsed = JSON.parse(raw) as VerdictsPayload;
    if (!Array.isArray(parsed.verdicts)) return null;
    return parsed.verdicts
      .filter((row) => typeof row.term === "string")
      .map((row) => ({
        term: row.term ?? "",
        offIntent: Boolean(row.off_intent ?? row.offIntent),
        confidence: Number(row.confidence ?? 0),
        reason: row.reason ?? "",
      }));
  } catch {
    return null;
  }
}

export function shouldNegate(
  verdicts: TermVerdict[] | null,
  term: string,
  minConfidence: number,
): boolean {
  if (verdicts === null) return false;
  const verdict = verdicts.find(
    (row) => row.term.toLowerCase() === term.toLowerCase(),
  );
  return Boolean(
    verdict && verdict.offIntent && verdict.confidence >= minConfidence,
  );
}

export async function classifyTerms(
  client: ClientConfig,
  terms: string[],
): Promise<TermVerdict[] | null> {
  const unique = [
    ...new Set(terms.map((term) => term.trim()).filter(Boolean)),
  ].slice(0, 80);
  if (unique.length === 0) return [];

  const { Graphed } = await import("@graphed-inc/sdk");
  const graphed = new Graphed();
  if (!graphed.isConfigured()) return null;

  const { relevanceModel } = await import("./config");
  const response = await fetch(graphed.openRouter.chatCompletionsUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${graphed.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: relevanceModel(),
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You audit Google Ads search terms. Reply with raw JSON only (no markdown): { verdicts: [{ term, off_intent, confidence, reason }] }.",
        },
        {
          role: "user",
          content: [
            "PRODUCT CONTEXT:",
            client.relevance.product_context,
            "",
            "off_intent=true only when the searcher's intent is clearly unrelated to this product.",
            "Close variants that still imply the product stay on-intent.",
            "Competitor brand names that imply the product are on-intent for Testing but must not be promoted to Winners — say so in reason (e.g. competitor brand — do not promote).",
            "",
            "TERMS:",
            ...unique.map((term) => `- ${term}`),
          ].join("\n"),
        },
      ],
    }),
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return null;
  return parseClassifierContent(content);
}
