import "dotenv/config";

import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createPostgresPool } from "./db/client.js";
import { runMigrations } from "./db/migrations/index.js";

const config = loadEnv();
const db = createPostgresPool(config.DATABASE_URL);
await runMigrations(db);

const app = await createApp(config, { db });

app.addHook("onClose", async () => {
  await db.end();
});

const close = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, "shutdown requested");
  await app.close();
};

process.once("SIGINT", (signal) => {
  void close(signal);
});

process.once("SIGTERM", (signal) => {
  void close(signal);
});

try {
  await app.listen({
    host: "0.0.0.0",
    port: config.PORT
  });
} catch (error) {
  app.log.error({ err: error }, "failed to start server");
  process.exitCode = 1;
}
