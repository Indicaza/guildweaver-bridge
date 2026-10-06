import { createCollectorServer } from "./app.js";
import { loadCollectorConfig } from "./config.js";
import { logger } from "./logger.js";
import { PostgresCollectorStore } from "./store/postgres.js";

const config = loadCollectorConfig();
const store = new PostgresCollectorStore({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl,
});

await store.migrate();
await store.ping();

const server = createCollectorServer({ store, config, logger });
server.listen(config.port, config.host, () => {
  logger.info("Guildweaver collector listening", {
    host: config.host,
    port: config.port,
  });
});

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  logger.info("Guildweaver collector stopping", { signal });
  server.close(async () => {
    await store.close();
    process.exitCode = 0;
  });
  setTimeout(() => {
    process.exitCode = 1;
    process.exit();
  }, 10_000).unref();
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));
