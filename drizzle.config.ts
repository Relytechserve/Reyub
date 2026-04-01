import { config } from "dotenv";
import { resolve } from "path";
import { defineConfig } from "drizzle-kit";

// drizzle-kit does not load `.env.local` by default; Next.js does.
config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
