import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>["db"];

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}

let shared: ReturnType<typeof createDb> | undefined;

// The app's connection; tests build their own with createDb.
export function appDb(): Db {
  shared ??= createDb(process.env.DATABASE_URL!);
  return shared.db;
}
