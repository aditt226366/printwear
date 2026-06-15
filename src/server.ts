import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { createApp } from "./app.js";
import { automationService } from "./services/automation.service.js";
import { authService } from "./services/auth.service.js";
import { logger } from "./utils/logger.js";

const app = createApp();
const port = Number(process.env.PORT) || 3000;

let server: ReturnType<typeof app.listen> | undefined;

function assertSupportedRuntime() {
  const majorVersion = Number(process.version.replace(/^v/, "").split(".")[0]);
  logger.info({ nodeVersion: process.version }, "Runtime Node Version:");
  if (majorVersion > 23) {
    const message = "Unsupported Node version. Use Node 22.";
    logger.fatal({ nodeVersion: process.version }, message);
    throw new Error(message);
  }
}

async function start() {
  assertSupportedRuntime();
  await authService.ensureSeedUsers();
  server = app.listen(port, () => {
    logger.info({ port }, "Server started");
    if (env.AUTOMATION_WORKERS_ENABLED) {
      automationService.startWorkers();
    } else {
      logger.warn("Automation workers disabled by AUTOMATION_WORKERS_ENABLED=false");
    }
  });
}

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down server");
  if (!server) {
    await prisma.$disconnect();
    process.exit(0);
  }
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (error) => {
  logger.fatal({ error }, "Uncaught exception");
  process.exit(1);
});

void start().catch((error) => {
  logger.fatal({ error }, "Server failed to start");
  process.exit(1);
});
