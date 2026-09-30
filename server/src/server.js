import { createApp } from "./app.js";
import { connectDb } from "./config/db.js";
import { startKeepAlive } from "./config/keepAlive.js";
import { env, isProd } from "./config/env.js";
import { logger } from "./config/logger.js";
import { getStorage } from "./integrations/storage/registry.js";

// A promise nobody awaited should not take the whole API down with it - and
// under `node --watch` a dead server stays dead until a file changes, which
// looked like the frontend crashing. Log it loudly and keep serving.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason instanceof Error ? reason : { message: String(reason) } }, "unhandled rejection");
});

// After an uncaught exception the process state cannot be trusted, so it still
// exits - but with the reason written down first.
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception - exiting");
  setTimeout(() => process.exit(1), 200).unref();
});

/**
 * The database is in the cloud, so a restart during a Wi-Fi or DNS blip used
 * to fail once and exit for good. In development it keeps retrying instead and
 * comes up on its own when the network does. Production still fails fast after
 * a few tries, so a real misconfiguration is not hidden behind endless retries.
 */
async function connectWithRetry() {
  for (let attempt = 1; ; attempt++) {
    try {
      return await connectDb();
    } catch (err) {
      if (isProd && attempt >= 5) throw err;
      const wait = Math.min(30, attempt * 5);
      logger.warn({ err: err.message, attempt }, `mongo unreachable; retrying in ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
}

async function main() {
  await connectWithRetry();

  // Settled before the first request, so every capability readout and every
  // vendor guard is answering from a verified fact rather than a hope.
  await getStorage().verifyPublicAccess();

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info({ port: env.port, provider: env.avatarProvider }, "api listening");
    startKeepAlive();
  });

  // Let in-flight requests finish rather than cutting live connections.
  const shutdown = (signal) => {
    logger.info({ signal }, "shutting down");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "failed to start");
  process.exit(1);
});
