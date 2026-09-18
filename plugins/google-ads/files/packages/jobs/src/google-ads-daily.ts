import { destroyDb } from "@app/core";
import { runAdsAgent } from "@app/core/google-ads/run";

// Entrypoint for the google-ads-daily cron job in graphed.yaml.
// Local: `graphed dev run -- npm run job:google-ads-daily`.
// Cloud: `graphed jobs run google-ads-daily`.
async function main(): Promise<void> {
  const result = await runAdsAgent();
  console.log(result.report);
  await destroyDb();
  if (result.infrastructure || result.status === "failed") {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
