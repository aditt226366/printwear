import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { createApp } from "./app.js";
import { logger } from "./utils/logger.js";

const app = createApp();
const port = Number(process.env.PORT) || 3000;

const server = app.listen(port, () => {
  logger.info({ port }, "Server started");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down server");
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
