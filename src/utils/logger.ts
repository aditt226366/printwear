import pino from "pino";
import { env } from "../config/env.js";
import { scrubSecretsFromLogs } from "./secretVault.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers.set-cookie",
      "*.token",
      "*.accessToken",
      "*.access_token",
      "*.apiKey",
      "*.api_key",
      "*.privateKey",
      "*.private_key",
      "*.password",
      "*.secret",
      "*.verifyToken",
      "*.verify_token"
    ],
    censor: "[redacted]"
  },
  formatters: {
    log(object) {
      return scrubSecretsFromLogs(object);
    }
  },
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard"
          }
        }
});
