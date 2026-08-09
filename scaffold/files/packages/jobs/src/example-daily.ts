import { destroyDb, getDb } from "@app/core";

// Entrypoint for the example-daily cron job in graphed.yaml. Run it locally
// with `npm run job:example-daily` (uses .env), trigger it in the cloud with
// `graphed jobs run example-daily`.
async function main(): Promise<void> {
  const message = `heartbeat from ${process.env.GRAPHED_TOKEN ? "graphed cloud" : "local dev"}`;
  await getDb().insertInto("example_heartbeats").values({ message }).execute();
  console.log(`Inserted: ${message}`);
  await destroyDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
