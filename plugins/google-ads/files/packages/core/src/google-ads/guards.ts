import type { CampaignRole, ClientConfig } from "./types";
import { campaignId, normKey } from "./types";

export type BlockReason =
  | "brand_protection"
  | "api_budget"
  | "write_cap"
  | "safeguard"
  | "loop_owns_promotions"
  | "campaigns_not_configured"
  | "invalid_scope"
  | "blocks_target_keyword"
  | "last_winners_group"
  | "budget_cap"
  | "budget_step"
  | "ads_credentials_missing"
  | "warehouse_stale"
  | "below_threshold"
  | "competitor_brand"
  | "own_brand"
  | "classifier_unavailable"
  | "low_confidence"
  | "blocked_terms_unreadable"
  | "blocked_terms_invalid";

export type WriteResult = {
  ok: boolean;
  applied: boolean;
  dryRun: boolean;
  blocked?: BlockReason;
  error?: string;
  resourceNames?: string[];
};

export function refuse(
  blocked: BlockReason,
  dryRun: boolean,
  error?: string,
): WriteResult {
  return { ok: false, applied: false, dryRun, blocked, error };
}

export function assertNotBrand(campaign: CampaignRole): BlockReason | null {
  return campaign === "brand" ? "brand_protection" : null;
}

export function addNegativeScopeError(
  campaign: "testing" | "winners",
  scope: "campaign" | "ad_group",
): BlockReason | null {
  if (campaign === "testing" && scope !== "campaign") return "invalid_scope";
  if (campaign === "winners" && scope !== "ad_group") return "invalid_scope";
  return null;
}

export function blocksTargetKeyword(
  term: string,
  targetKeyword: string,
): boolean {
  const a = normKey(term);
  const b = normKey(targetKeyword);
  if (a === b) return true;
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
}

export function budgetStepExceeded(
  current: number,
  next: number,
  maxShiftPct: number,
): boolean {
  if (current <= 0) return next > 0 && maxShiftPct <= 0;
  return Math.abs(next - current) / current > maxShiftPct + 1e-9;
}

export function budgetCapExceeded(
  testingDaily: number,
  winnersDaily: number,
  brandDaily: number,
  cap: number,
): boolean {
  return testingDaily + winnersDaily + brandDaily > cap + 1e-6;
}

export function promoteLoopBlock(
  loopOwnsPromotions: boolean,
): BlockReason | null {
  return loopOwnsPromotions ? "loop_owns_promotions" : null;
}

export function requireCampaign(
  client: ClientConfig,
  role: "testing" | "winners",
): string | null {
  return campaignId(client, role);
}
