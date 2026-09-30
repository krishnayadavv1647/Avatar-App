import pino from "pino";
import { env, isProd } from "./env.js";

// In development the log also goes to logs/server.log, so when the dev server
// dies the reason survives the terminal it was printed in. (*.log is ignored
// by git.)
// Each target has its own level, and it defaults to "info" - without naming it
// here, every debug line would be dropped from both outputs.
const devTransport = {
  targets: [
    { target: "pino-pretty", level: "debug", options: { colorize: true } },
    {
      target: "pino-pretty",
      level: "debug",
      options: { colorize: false, destination: "./logs/server.log", mkdir: true, append: true },
    },
  ],
};

export const logger = pino({
  level: isProd ? "info" : "debug",
  transport: isProd ? undefined : devTransport,
  base: { env: env.nodeEnv },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.apiKey",
      "*.secret",
      "*.password",
      "*.passwordHash",
    ],
    remove: true,
  },
});
