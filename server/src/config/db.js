import dns from "node:dns";
import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "./logger.js";

let listening = false;
let fallbackDns = false;

/**
 * Node reads the machine's DNS servers once, when the process starts. If the
 * network changes afterwards - the laptop wakes up, Wi-Fi reconnects, a VPN
 * toggles - a long-running process keeps asking the old address, and Atlas's
 * SRV lookup fails with "querySrv ECONNREFUSED" on every retry, for good.
 *
 * So when a lookup fails, public resolvers are added behind the configured
 * ones. They are only ever a fallback: the machine's own servers stay first.
 */
function addFallbackDns(err) {
  if (fallbackDns || !/querySrv|ENOTFOUND|ETIMEOUT|ESERVFAIL/i.test(err?.message || "")) return;
  fallbackDns = true;
  const servers = [...new Set([...dns.getServers(), "8.8.8.8", "1.1.1.1"])];
  try {
    dns.setServers(servers);
    logger.warn({ servers }, "dns lookup failed; added public resolvers as fallback");
  } catch (e) {
    logger.warn({ err: e.message }, "could not add fallback dns");
  }
}

export async function connectDb(uri = env.mongoUri) {
  mongoose.set("strictQuery", true);

  // Once connected, Mongoose reconnects by itself, but it reports drops as
  // "error" events - and an "error" event with no listener is thrown, which
  // took the whole API down on a brief network blip.
  if (!listening) {
    listening = true;
    mongoose.connection.on("error", (err) => {
      logger.error({ err: err.message }, "mongo error");
      addFallbackDns(err);
    });
    mongoose.connection.on("disconnected", () => logger.warn("mongo disconnected; reconnecting"));
    mongoose.connection.on("reconnected", () => logger.info("mongo reconnected"));
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  } catch (err) {
    // The caller decides whether to retry; the next attempt gets the fallback.
    addFallbackDns(err);
    throw err;
  }
  logger.info({ uri: uri.replace(/\/\/.*@/, "//***@") }, "mongo connected");
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
