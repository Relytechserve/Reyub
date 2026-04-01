/**
 * Verify Qogita credentials: loads .env.local, obtains an access token (login or pinned).
 *
 *   npm run qogita:auth
 *
 * Does not print the full token.
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

async function main() {
  const { getQogitaAccessToken } = await import("../lib/qogita/auth");
  const token = await getQogitaAccessToken();
  const source = process.env.QOGITA_API_TOKEN?.trim()
    ? "QOGITA_API_TOKEN (pinned)"
    : "QOGITA_EMAIL + QOGITA_PASSWORD (login)";
  console.log("OK —", source);
  console.log("Access token length:", token.length);
  console.log("Prefix:", `${token.slice(0, 12)}…`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
