import { destroyDb } from "@app/core";
import { runSeoPipeline } from "@app/core/seo/pipeline";

// Entrypoint for the seo-publish-daily cron job in graphed.yaml.
// Local: `npm run job:seo-publish-daily`.
// Cloud: `graphed jobs run seo-publish-daily`.
async function main(): Promise<void> {
  const result = await runSeoPipeline();
  console.log(
    `Done: ${result.status}${result.publicUrl ? ` — ${result.publicUrl}` : ""}`,
  );
  await destroyDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
