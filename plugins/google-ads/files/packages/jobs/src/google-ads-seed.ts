import { readFileSync } from "node:fs";
import { destroyDb } from "@app/core";
import { createAdsClient } from "@app/core/google-ads/client";
import { adsCredentials, loadClientConfig } from "@app/core/google-ads/config";
import {
  applyTestingSeeds,
  listAccountKeywordSnapshot,
  previewTestingSeeds,
} from "@app/core/google-ads/seed";
import { writesEnabled } from "@app/core/google-ads/types";
import { seedTestingKeywords } from "@app/core/google-ads/writes";

// Setup helper for the implementing coding agent — not a cron job, not
// called by the daily Mastra agent. See AGENT.md "Find Testing keywords".
// DataForSEO runs only with --target or --from-json. Bare / --from-account
// lists warehouse keywords. A user-pasted list uses --terms.
//   graphed dev run -- npx tsx packages/jobs/src/google-ads-seed.ts --from-account
//   graphed dev run -- npx tsx packages/jobs/src/google-ads-seed.ts --terms "ai ads agent,warehouse analytics"
//   graphed dev run -- npx tsx packages/jobs/src/google-ads-seed.ts --target graphed.com
//   graphed dev run -- npx tsx packages/jobs/src/google-ads-seed.ts --from-json clients/google-ads/seed.example.json
//   graphed dev run -- npx tsx packages/jobs/src/google-ads-seed.ts --terms "ai ads agent" --apply
// --apply still uses validateOnly when writes.enabled is false.

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return undefined;
  return value;
}

function parseTerms(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
}

function adsCredentialsOrPreview(): boolean {
  try {
    if (adsCredentials()) return true;
    console.error("GOOGLE_ADS_SA_KEY_JSON is not set. Preview only.");
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Invalid GOOGLE_ADS_SA_KEY_JSON",
    );
  }
  // --apply asked for a mutate and did not get one.
  process.exitCode = 1;
  return false;
}

function parseOfflineJson(path: string): {
  payload: unknown;
  source: "site" | "ideas";
  target?: string;
} {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const doc = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const tool = typeof doc.tool === "string" ? doc.tool : "";
  const target = typeof doc.target === "string" ? doc.target : undefined;
  return {
    payload: raw,
    source: tool.includes("keyword_ideas") ? "ideas" : "site",
    target,
  };
}

async function listAccount(client: ReturnType<typeof loadClientConfig>): Promise<void> {
  const snapshot = await listAccountKeywordSnapshot(client);
  console.log(
    [
      "Account keywords (warehouse)",
      `testing_positives=${snapshot.testing.positives.length}`,
      `testing_negatives=${snapshot.testing.negatives.length}`,
      `winners_positives=${snapshot.winners.positives.length}`,
      `winners_negatives=${snapshot.winners.negatives.length}`,
    ].join("\n"),
  );
  console.log(JSON.stringify(snapshot, null, 2));
}

async function main(): Promise<void> {
  try {
    await runSeed();
  } finally {
    await destroyDb();
  }
}

async function runSeed(): Promise<void> {
  const apply = hasFlag("--apply");
  const fromAccount = hasFlag("--from-account");
  const fromJson = argValue("--from-json");
  const target = argValue("--target");
  const terms = parseTerms(argValue("--terms"));
  const client = loadClientConfig();
  const wantsResearch = Boolean(target || fromJson);
  const dryRun = !writesEnabled(client);

  if (fromAccount && (wantsResearch || terms.length > 0)) {
    console.error(
      "--from-account cannot be combined with --target, --from-json, or --terms",
    );
    process.exitCode = 1;
    return;
  }

  if (terms.length > 0) {
    console.log(
      ["Seed terms", `terms=${terms.length}`, terms.map((term) => `- ${term}`).join("\n")].join(
        "\n",
      ),
    );
    if (apply && adsCredentialsOrPreview()) {
      const ads = await createAdsClient(
        client,
        client.agent.max_api_operations_per_run,
      );
      if (!ads) {
        // Unreachable today: adsCredentialsOrPreview() already excluded the
        // only null case. Keep the term list if it ever fires.
        console.error("Could not build an Ads client. Preview only.");
        process.exitCode = 1;
      } else {
        const seeded = await seedTestingKeywords(ads, client, {
          terms,
          dryRun,
        });
        console.log(
          [
            `mutated=${seeded.applied} dryRun=${seeded.dryRun} createdAdGroup=${seeded.createdAdGroup}`,
            seeded.error ? `error=${seeded.error}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        );
        console.log(JSON.stringify(seeded, null, 2));
      }
    }
    return;
  }

  if (fromAccount || !wantsResearch) {
    if (apply) {
      console.error("--apply needs --terms, --target, or --from-json");
      process.exitCode = 1;
      return;
    }
    await listAccount(client);
    return;
  }

  const offline = fromJson ? parseOfflineJson(fromJson) : null;
  const preview = await previewTestingSeeds(client, {
    target: target ?? offline?.target,
    ...(offline ? { fromPayload: offline } : {}),
  });

  let result = preview;
  if (apply && adsCredentialsOrPreview()) {
    const ads = await createAdsClient(
      client,
      client.agent.max_api_operations_per_run,
    );
    if (!ads) {
      // Unreachable today: adsCredentialsOrPreview() already excluded the
      // only null case. Keep the paid-for preview output if it ever fires.
      console.error("Could not build an Ads client. Preview only.");
      process.exitCode = 1;
    } else {
      result = await applyTestingSeeds(ads, client, preview, dryRun);
    }
  }

  console.log(
    [
      apply ? "Seed apply" : "Seed preview",
      `target=${result.target || "(none)"}`,
      `tools=${result.toolsUsed.join(",") || "none"}`,
      `keepers=${result.keywords.length}`,
      `dropped_off_intent=${result.droppedOffIntent.length}`,
      result.classifierUnavailable ? "classifier=unavailable" : "classifier=ok",
      result.seeded
        ? `mutated=${result.seeded.applied} dryRun=${result.seeded.dryRun} createdAdGroup=${result.seeded.createdAdGroup}`
        : "mutated=no",
      dryRun
        ? "writes.enabled=false (validateOnly if --apply)"
        : "writes.enabled=true",
    ].join("\n"),
  );
  if (result.error) console.error(`research_error=${result.error}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
