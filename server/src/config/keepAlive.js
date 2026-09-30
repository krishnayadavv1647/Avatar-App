import { env } from "./env.js";
import { logger } from "./logger.js";

/**
 * Keeps a free-tier host from putting the service to sleep.
 *
 * Hosts like Render spin a free web service down after 15 minutes with no
 * inbound traffic. When the agent worker runs in the same service, that takes
 * the worker down too - and a call in progress sends no HTTP requests, so a
 * long call could be cut off mid-sentence. Requesting our own public address
 * every few minutes counts as inbound traffic and keeps both awake.
 *
 * On by itself on Render, which hands every service its public address as
 * RENDER_EXTERNAL_URL; elsewhere set KEEP_ALIVE_URL. With neither (a laptop,
 * a host that never sleeps) it does nothing.
 */
export function startKeepAlive() {
  const base = env.keepAlive.url;
  if (!base) return null;

  const url = `${base.replace(/\/$/, "")}/api/health`;
  const everyMs = env.keepAlive.minutes * 60 * 1000;

  const ping = async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      logger.debug({ status: res.status }, "keep-alive ping");
    } catch (err) {
      // Never fatal: a missed ping is retried at the next interval.
      logger.warn({ err: err.message }, "keep-alive ping failed");
    }
  };

  // unref: the timer must never be the thing keeping the process alive.
  const timer = setInterval(ping, everyMs);
  timer.unref();
  logger.info({ url, everyMinutes: env.keepAlive.minutes }, "keep-alive on");
  return timer;
}
