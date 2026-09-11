import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Pool } from "pg";
import { buildApp } from "./app.js";
import { readEnv } from "./env.js";
import { ExecutionEngine } from "./execution-engine.js";
import { PostgresStore } from "./store.js";
import { DreamDexVenue } from "./venue.js";
import { QuotingBot } from "./quoting-bot.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
dotenv.config({ path: path.join(projectRoot, ".env") });

const env = readEnv();
const db = new Pool({ connectionString: env.databaseUrl });
const store = new PostgresStore(db);
await store.ensureSchema();
const repairedReceipts = await store.repairMissingReceipts();
if (repairedReceipts > 0) console.info(`Repaired ${repairedReceipts} terminal execution receipt(s)`);
const venue = new DreamDexVenue(env);
const engine = new ExecutionEngine(venue, store, env);
const quoter = new QuotingBot(venue, env, (message, details) => console.info(message, details));
const app = await buildApp({ env, store, venue, engine, quoter });
void engine.resumeActive().catch((error: unknown) => {
  app.log.error({ error }, "Unable to resume persisted Slice executions");
});
void quoter.start();
const heartbeat = setInterval(() => engine.touch(), env.slice.heartbeatIntervalMs);
heartbeat.unref();

const shutdown = async (signal: string) => {
  clearInterval(heartbeat);
  app.log.info({ signal }, "shutting down Slice");
  await quoter.stop();
  await app.close();
  await db.end();
};

process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });

await app.listen({ host: "0.0.0.0", port: env.port });
