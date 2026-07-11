import pg from "pg";

export type Db = pg.Pool;

export function createPostgresPool(databaseUrl: string): Db {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 5
  });
}
