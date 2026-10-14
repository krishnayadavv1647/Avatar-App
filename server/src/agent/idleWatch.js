/**
 * Ends a call nobody is using.
 *
 * A call is billed for every second it is open. A tab left open on a share link
 * (or a caller who walked away mid-call) costs exactly as much as one being
 * talked in, so after a stretch of silence the avatar checks in once - "are you
 * still there?" - and, if nobody answers, the call ends.
 *
 * "Silence" means nobody spoke and the avatar was not speaking or thinking: a
 * long answer is not idle. The clock is injected so the rules can be tested
 * without waiting.
 *
 * @param {object} options
 * @param {number} options.idleSeconds    silence after which the call ends; 0 turns this off
 * @param {number} [options.warnSeconds]  silence after which the avatar checks in once
 * @param {() => boolean} [options.busy]  true while someone is speaking or the avatar is
 * @param {() => void} options.onWarn
 * @param {() => void} options.onIdle
 */
export function createIdleWatch({
  idleSeconds,
  warnSeconds = Math.max(5, idleSeconds - 20),
  busy = () => false,
  onWarn,
  onIdle,
  now = () => Date.now(),
  checkEveryMs = 2_000,
}) {
  let last = now();
  let warned = false;
  let done = false;
  let timer = null;

  const touch = () => {
    last = now();
    // Someone is there again: a later silence gets its own check-in.
    warned = false;
  };

  const check = () => {
    if (done) return;
    if (busy()) {
      // Before the check-in, the avatar talking is the call being used. After it,
      // the avatar talking is the check-in itself: that must not reset the
      // clock, or one question would keep the call alive for ever. Only the
      // person speaking (a `touch`) brings the call back.
      if (!warned) touch();
      return;
    }

    const silentMs = now() - last;
    if (silentMs >= idleSeconds * 1000) {
      done = true;
      stop();
      onIdle();
    } else if (!warned && silentMs >= warnSeconds * 1000) {
      warned = true;
      onWarn();
    }
  };

  // Once stopped (the call is over, or it ended for being idle) it never fires again.
  const stop = () => {
    done = true;
    clearInterval(timer);
    timer = null;
  };

  return {
    /** Starts the clock from now. A no-op when idle detection is off. */
    start() {
      if (!(idleSeconds > 0) || timer) return;
      last = now();
      warned = false;
      timer = setInterval(check, checkEveryMs);
      timer.unref?.();
    },
    /** The person spoke: the call is in use again and a later silence gets its own check-in. */
    touch,
    stop,
    /** For tests: run one check now. */
    check,
  };
}
