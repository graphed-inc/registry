import { destroyDb } from "@app/core";
import { processOutboundInbox } from "@app/core/outbound/inbox";

// Entrypoint for the outbound-replies cron. Campaigns default to Off, so a
// fresh install logs and exits without calling Instantly.
async function main(): Promise<void> {
  await processOutboundInbox();
  await destroyDb();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await destroyDb();
  process.exit(1);
});
