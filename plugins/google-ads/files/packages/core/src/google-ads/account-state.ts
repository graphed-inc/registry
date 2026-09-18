import type { AdsClient } from "./client";
import type { ClientConfig } from "./types";
import {
  quoteNumericId,
  schemaFromClient,
  warehouseQuery,
  warehouseQueryAllowMissing,
} from "./warehouse";

export type EnabledAdGroup = {
  adGroupId: string;
  status: string;
};

export type CampaignBudget = {
  campaignId: string;
  daily: number;
  resourceName: string;
};

type AdsSearch = Pick<AdsClient, "search">;

type CampaignBudgetRow = {
  campaign?: { id?: string };
  campaignBudget?: {
    resourceName?: string;
    amountMicros?: string | number;
  };
};

function customerId(client: ClientConfig): string {
  return quoteNumericId(client.google_ads.customer_id, "customer id");
}

export async function listEnabledAdGroups(
  client: ClientConfig,
  campaign: string,
): Promise<EnabledAdGroup[]> {
  const schema = schemaFromClient(client);
  if (!schema) return [];
  const campaignKey = quoteNumericId(campaign, "campaign id");
  const result = await warehouseQuery(`SELECT
      toString(id) AS ad_group_id,
      status
    FROM ${schema}.ad_group_history
    WHERE _fivetran_active = 1
      AND toString(campaign_id) = '${campaignKey}'
      AND upper(status) = 'ENABLED'`);
  return result.results
    .map((row) => ({
      adGroupId: String(row.ad_group_id ?? ""),
      status: String(row.status ?? ""),
    }))
    .filter((row) => row.adGroupId);
}

export async function listCampaignBudgets(
  client: ClientConfig,
  campaignIds: string[],
  ads?: AdsSearch | null,
): Promise<CampaignBudget[]> {
  const schema = schemaFromClient(client);
  if (!schema || campaignIds.length === 0) return [];
  const keys = campaignIds.map((id) => quoteNumericId(id, "campaign id"));
  const customer = customerId(client);
  const result = await warehouseQueryAllowMissing(`SELECT
      toString(campaign_id) AS campaign_id,
      toString(id) AS budget_id,
      amount_micros
    FROM ${schema}.campaign_budget_history
    WHERE _fivetran_active = 1
      AND toString(campaign_id) IN (${keys.map((id) => `'${id}'`).join(", ")})`);
  const fromWarehouse = result.missingTable
    ? []
    : result.results
        .map((row) => {
          const campaignId = String(row.campaign_id ?? "");
          const budgetId = String(row.budget_id ?? "");
          const micros = Number(row.amount_micros ?? 0);
          return {
            campaignId,
            daily: Number.isFinite(micros) ? micros / 1_000_000 : 0,
            resourceName: budgetId
              ? `customers/${customer}/campaignBudgets/${budgetId}`
              : "",
          };
        })
        .filter((row) => row.campaignId && row.resourceName);

  const have = new Set(
    fromWarehouse.map((row) => row.campaignId.replace(/-/g, "")),
  );
  const missingKeys = keys.filter((id) => !have.has(id));
  if (missingKeys.length === 0 || !ads) return fromWarehouse;

  const rows = await ads.search<CampaignBudgetRow>(`
    SELECT campaign.id, campaign_budget.resource_name, campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.id IN (${missingKeys.join(", ")})`);
  const fromAds = rows
    .map((row) => {
      const campaignId = row.campaign?.id ? String(row.campaign.id) : "";
      const resourceName = row.campaignBudget?.resourceName ?? "";
      const micros = Number(row.campaignBudget?.amountMicros ?? 0);
      return {
        campaignId,
        daily: Number.isFinite(micros) ? micros / 1_000_000 : 0,
        resourceName,
      };
    })
    .filter((row) => row.campaignId && row.resourceName);
  return [...fromWarehouse, ...fromAds];
}
