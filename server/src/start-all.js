import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Runs the whole product as one service: the API (which also serves the web
 * app in production) and the agent worker that joins calls.
 *
 *   npm --prefix server run start:all      (or `npm start` from the repo root)
 *
 * They stay two processes - the worker forks a process per call and must not
 * share a crash with the API - but one command starts both, and if either one
 * stops, the other is stopped too and this exits non-zero. A host that
 * restarts failed services (Render, Railway, a process manager) then brings
 * both back together, instead of leaving an API with no worker behind it,
 * which looks healthy and cannot take a single call.
 *
 * Small-instance defaults for the worker are set here unless the environment
 * already says otherwise. They come from running on a fractional-CPU free
 * instance, where the SDK's own defaults left the worker registered but
 * useless: one warm job process rather than four; no refusing calls for load
 * (load is measured against the instance's own small CPU quota, so it reads
 * ~1.0 whenever anything runs); and two minutes, not ten seconds, for a job
 * process to start.
 */
const serverDir = path.resolve(import.meta.dirname, "..");

const env = {
  ...process.env,
  AGENT_IDLE_PROCESSES: process.env.AGENT_IDLE_PROCESSES || "1",
  AGENT_LOAD_THRESHOLD: process.env.AGENT_LOAD_THRESHOLD || "2",
  AGENT_INIT_TIMEOUT_MS: process.env.AGENT_INIT_TIMEOUT_MS || "120000",
};

const parts = [
  { name: "api", args: ["src/server.js"] },
  { name: "agent", args: ["src/agent/worker.js", "start"] },
];

let stopping = false;
const children = parts.map(({ name, args }) => {
  const child = spawn(process.execPath, args, { cwd: serverDir, env, stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`[start-all] ${name} stopped (${signal || `exit ${code}`}); stopping the rest`);
    shutdown(code === 0 ? 1 : code || 1);
  });
  child.on("error", (err) => {
    console.error(`[start-all] ${name} could not start: ${err.message}`);
    shutdown(1);
  });
  return child;
});

function shutdown(exitCode) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
  }
  // Give them a moment to close calls and connections, then leave regardless.
  setTimeout(() => process.exit(exitCode), 10_000).unref();
  Promise.all(children.map((c) => (c.exitCode !== null ? null : new Promise((r) => c.once("exit", r))))).then(() =>
    process.exit(exitCode),
  );
}

// The host asking us to stop (a deploy, a restart) is a clean exit.
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
