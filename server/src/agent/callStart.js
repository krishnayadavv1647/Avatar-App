/**
 * When a call is billed from: the first time anyone actually speaks.
 *
 * Between the caller being in the room and the avatar's first word there is a
 * stretch where the model is writing its greeting and the voice is being made.
 * Nobody is being talked to yet, so it must not be on the meter. The clock
 * starts at the first word - the avatar's greeting, or the caller speaking first
 * - and a call where neither happens within a short time never starts, and is
 * never billed.
 */
export const FIRST_SPEECH_TIMEOUT_MS = 45_000;

/**
 * Resolves with who spoke first - "agent" or "user" - or null if nobody did
 * within the time allowed or the session closed first.
 *
 * Attach it BEFORE asking the avatar to speak, so its first word cannot slip by.
 *
 * @param {{ on: Function, off?: Function, removeListener?: Function }} session
 */
export function waitForFirstSpeech(session, { timeoutMs = FIRST_SPEECH_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const remove = (event, fn) => (session.off || session.removeListener)?.call(session, event, fn);

    const done = (who) => {
      clearTimeout(timer);
      remove("agent_state_changed", onAgent);
      remove("user_state_changed", onUser);
      remove("close", onClose);
      resolve(who);
    };
    const onAgent = (ev) => ev?.newState === "speaking" && done("agent");
    const onUser = (ev) => ev?.newState === "speaking" && done("user");
    const onClose = () => done(null);
    const timer = setTimeout(() => done(null), timeoutMs);

    session.on("agent_state_changed", onAgent);
    session.on("user_state_changed", onUser);
    session.on("close", onClose);
  });
}

/**
 * How the avatar opens the call. A greeting the owner wrote is spoken as it is -
 * no model in between, so there is no "thinking" before the first word and no
 * tokens spent. Only an avatar with no greeting asks the model to make one up.
 *
 * @returns {{ say: string } | { reply: { instructions: string } }}
 */
export function greetingFor(persona, { direct = true } = {}) {
  const written = typeof persona?.greeting === "string" ? persona.greeting.trim() : "";
  if (written && direct) return { say: written };
  // The earlier behaviour (GREETING_DIRECT=false): the model gets the greeting as its instruction.
  return { reply: { instructions: written || "Greet the caller warmly in one sentence." } };
}
