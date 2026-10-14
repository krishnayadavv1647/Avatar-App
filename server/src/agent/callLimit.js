import { env } from "../config/env.js";

/**
 * How long a call may run, in seconds: the avatar's own setting, else the
 * install's default (five minutes unless DEFAULT_CALL_SECONDS says otherwise).
 *
 * This is also the only cap on what one caller on a public share link can
 * spend, which is why the default is short.
 */
export const callLimitSeconds = (persona) => persona?.maxCallSeconds || env.defaultCallSeconds;
