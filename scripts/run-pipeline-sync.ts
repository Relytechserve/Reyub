/**
 * One-shot full pipeline sync (Qogita → DB, Keepa bestsellers → DB, EAN match).
 * Same logic as the dashboard and GET /api/cron/sync. Requires .env.local.
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

async function main() {
  const { runFullPipelineSync } = await import("../lib/sync/pipeline");
  const result = await runFullPipelineSync();
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
