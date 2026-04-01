import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | null = null;

/** Neon + Drizzle client. Requires DATABASE_URL at runtime. */
export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env.local (see .env.example)."
    );
  }
  if (!_db) {
    _db = drizzle(neon(url), { schema });
  }
  return _db;
}
