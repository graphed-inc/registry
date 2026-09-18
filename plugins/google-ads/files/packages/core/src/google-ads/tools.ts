import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { classifyTerms } from "./classify";
import { AdsApiError } from "./client";
import { cachedHealth, type AgentRunContext } from "./context";
import { listKeywords } from "./keywords";
import { getScoreboard } from "./scoreboard";
import { listSearchTerms } from "./search-terms";
import { memoryGet, memorySet } from "./store";
import { runWriteTool } from "./write-contract";
import {
  addNegative,
  pauseAdGroup,
  promoteSearchTerm,
  rebalanceBudgets,
  removeNegative,
} from "./writes";

const campaignRoleSchema = z.enum(["testing", "winners", "brand"]);
const writeCampaignSchema = z.enum(["testing", "winners"]);

export function createAdsTools(ctx: AgentRunContext) {
  return {
    memory_get: createTool({
      id: "memory_get",
      description:
        "Read standing notes for this client. Omit keys to load every note.",
      inputSchema: z.object({
        keys: z
          .array(z.string())
          .optional()
          .describe("Note keys. Omit for all keys."),
      }),
      outputSchema: z.object({
        items: z.array(
          z.object({
            key: z.string(),
            value: z.string(),
            updatedAt: z.string(),
          }),
        ),
      }),
      execute: async (input) => ({
        items: await memoryGet(ctx.client.client_key, input.keys),
      }),
    }),

    memory_set: createTool({
      id: "memory_set",
      description:
        "Replace one standing note. Rewrite the whole value; do not append.",
      inputSchema: z.object({
        key: z.string().describe("Note key, e.g. baselines or watch_items"),
        value: z.string().describe("Full replacement text"),
      }),
      outputSchema: z.object({
        ok: z.literal(true),
        key: z.string(),
        updatedAt: z.string(),
      }),
      execute: async (input) => {
        const saved = await memorySet(
          ctx.client.client_key,
          input.key,
          input.value,
        );
        return { ok: true as const, ...saved };
      },
    }),

    get_scoreboard: createTool({
      id: "get_scoreboard",
      description:
        "Warehouse KPI scoreboard. Does not call the Ads API. Use windows [7, 30] first.",
      inputSchema: z.object({
        windows: z
          .array(z.number().int().positive())
          .min(1)
          .describe("Lookback windows in days"),
        groupBy: z.enum(["campaign", "ad_group"]),
      }),
      execute: async (input) => {
        const board = await getScoreboard(
          ctx.client,
          input.windows,
          input.groupBy,
        );
        if (
          typeof board.warehouseLagHours === "number" &&
          Number.isFinite(board.warehouseLagHours)
        ) {
          ctx.warehouseLagHours = board.warehouseLagHours;
          ctx.warehouseLagChecked = true;
        }
        return {
          generatedAt: board.generatedAt,
          asOfDate: board.asOfDate,
          warehouseLagHours: board.warehouseLagHours,
          rows: board.rows.map((row) => ({
            ...row,
            dailyBudget: null,
            pacingPct: null,
          })),
        };
      },
    }),

    list_search_terms: createTool({
      id: "list_search_terms",
      description:
        "Warehouse search-term hunt. Use this to find waste and converters.",
      inputSchema: z.object({
        campaign: campaignRoleSchema,
        lookbackDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
        sort: z.enum(["spend", "conversions", "cpa"]),
        conversions: z.enum(["any", "converters", "zero"]).optional(),
        minSpend: z.number().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      execute: async (input) => ({
        terms: await listSearchTerms(ctx.client, input),
      }),
    }),

    list_keywords: createTool({
      id: "list_keywords",
      description:
        "Positives and negatives. Ad-group rows come from the warehouse; campaign negatives fall back to Ads search when that history table is missing. Brand is refused.",
      inputSchema: z.object({
        campaign: writeCampaignSchema,
        kind: z.enum(["positives", "negatives", "both"]),
      }),
      execute: async (input) => {
        try {
          return await listKeywords(
            ctx.client,
            input.campaign,
            input.kind,
            ctx.ads,
          );
        } catch (error) {
          if (error instanceof AdsApiError && error.code === "api_budget") {
            return {
              positives: [],
              negatives: [],
              truncated: true,
              error: "api_budget",
            };
          }
          throw error;
        }
      },
    }),

    get_serving_health: createTool({
      id: "get_serving_health",
      description:
        "Recent vs baseline impressions for Testing and Winners. Cached for the rest of the run.",
      inputSchema: z.object({}),
      execute: async () => cachedHealth(ctx),
    }),

    add_negative: createTool({
      id: "add_negative",
      description:
        "Add a negative keyword. Testing must be campaign scope. Winners must be ad-group EXACT and must not block that group's target.",
      inputSchema: z.object({
        campaign: writeCampaignSchema,
        scope: z.enum(["campaign", "ad_group"]),
        adGroupId: z.string().optional(),
        term: z.string(),
        matchType: z.enum(["EXACT", "PHRASE"]),
        reason: z.string(),
      }),
      execute: async (input) =>
        runWriteTool(
          ctx,
          {
            tool: "add_negative",
            payload: input,
            reason: input.reason,
            campaign: input.campaign,
          },
          (ads) =>
            addNegative(ads, ctx.client, {
              campaign: input.campaign,
              scope: input.scope,
              adGroupId: input.adGroupId,
              term: input.term,
              matchType: input.matchType,
              dryRun: ctx.dryRun,
            }),
        ),
    }),

    remove_negative: createTool({
      id: "remove_negative",
      description:
        "Remove a live negative by resource name. Not safeguard-gated — this is the undo path.",
      inputSchema: z.object({
        campaign: writeCampaignSchema,
        resourceName: z.string(),
        reason: z.string(),
      }),
      execute: async (input) =>
        runWriteTool(
          ctx,
          {
            tool: "remove_negative",
            payload: input,
            reason: input.reason,
            campaign: input.campaign,
            skipSafeguard: true,
          },
          (ads) =>
            removeNegative(ads, ctx.client, {
              campaign: input.campaign,
              resourceName: input.resourceName,
              dryRun: ctx.dryRun,
            }),
        ),
    }),

    promote_search_term: createTool({
      id: "promote_search_term",
      description:
        "Promote a Testing converter into Winners (exact keyword + RSA) and add a Testing EXACT negative. Refuses own-brand and competitor-brand terms (LLM judge plus config / blocked_terms lists). Blocked when LOOP_OWNS_PROMOTIONS is true.",
      inputSchema: z.object({
        term: z.string(),
        reason: z.string(),
      }),
      execute: async (input) =>
        runWriteTool(
          ctx,
          {
            tool: "promote_search_term",
            payload: input,
            reason: input.reason,
            campaign: "winners",
          },
          (ads) =>
            promoteSearchTerm(ads, ctx.client, {
              term: input.term,
              dryRun: ctx.dryRun,
            }),
        ),
    }),

    pause_ad_group: createTool({
      id: "pause_ad_group",
      description:
        "Pause a Winners ad group. Refuses the last enabled Winners group.",
      inputSchema: z.object({
        campaign: z.literal("winners"),
        adGroupId: z.string(),
        reason: z.string(),
      }),
      execute: async (input) =>
        runWriteTool(
          ctx,
          {
            tool: "pause_ad_group",
            payload: input,
            reason: input.reason,
            campaign: "winners",
          },
          (ads) =>
            pauseAdGroup(ads, ctx.client, {
              adGroupId: input.adGroupId,
              dryRun: ctx.dryRun,
            }),
        ),
    }),

    rebalance_budgets: createTool({
      id: "rebalance_budgets",
      description:
        "Set Testing and Winners daily budgets in dollars. Will not raise the combined cap or move a campaign more than max_daily_shift_pct.",
      inputSchema: z.object({
        testingDaily: z.number().nonnegative(),
        winnersDaily: z.number().nonnegative(),
        reason: z.string(),
      }),
      execute: async (input) =>
        runWriteTool(
          ctx,
          {
            tool: "rebalance_budgets",
            payload: input,
            reason: input.reason,
          },
          (ads) =>
            rebalanceBudgets(ads, ctx.client, {
              testingDaily: input.testingDaily,
              winnersDaily: input.winnersDaily,
              dryRun: ctx.dryRun,
            }),
        ),
    }),

    classify_terms: createTool({
      id: "classify_terms",
      description:
        "LLM intent check. Returns null if the classifier is down — do not guess, skip the decision.",
      inputSchema: z.object({
        terms: z.array(z.string()).max(80),
      }),
      execute: async (input) => ({
        verdicts: await classifyTerms(ctx.client, input.terms),
      }),
    }),
  };
}
