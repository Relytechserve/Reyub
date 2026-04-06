/**
 * Load local secrets before any test imports app code that reads process.env.
 * .env.local is gitignored — never commit credentials.
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });
