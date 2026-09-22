import { destroyDb } from "@app/core";
import { cmsRefreshShouldFail } from "@app/core/seo/refresh";
import { runSeoRefresh } from "@app/core/seo/refresh-loop";

// Entrypoint for the seo-refresh cron job in graphed.yaml.
// Local: `graphed dev run -- npm run job:seo-refresh`.
// Cloud: `graphed jobs run seo-refresh`.
// Writes are off until SEO_REFRESH_APPLY=true or `--apply` is passed.

function argValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const result = await runSeoRefresh({
    apply: process.argv.includes("--apply"),
    slug: argValue("--slug"),
  });
  console.log(
    `Done: batch ${result.batch} of ${result.corpus} published (apply=${result.apply})`,
  );
  await destroyDb();
  if (cmsRefreshShouldFail(result.cmsWrites, result.cmsFailures)) {
    console.error(
      `[seo-refresh] all ${result.cmsFailures} CMS updates failed`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
