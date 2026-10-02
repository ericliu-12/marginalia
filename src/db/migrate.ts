import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, type Db } from "./client";

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: "./drizzle" });
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  const { db, pool } = createDb(process.env.DATABASE_URL!);
  await runMigrations(db);
  await pool.end();
  console.log("migrated");
}
