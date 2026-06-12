import cors from "cors";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { authRoutes } from "./routes/auth.routes.js";
import pinoHttp from "pino-http";
import { adminRoutes } from "./routes/admin.routes.js";
import { apiRoutes } from "./routes/api.routes.js";
import { webhookRoutes } from "./routes/webhook.routes.js";
import { errorHandler, notFoundHandler } from "./utils/errors.js";
import { logger } from "./utils/logger.js";

const publicDir = path.resolve(process.cwd(), "public");

export function createApp() {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "default-src": ["'self'"],
          "base-uri": ["'self'"],
          "font-src": ["'self'", "https://fonts.gstatic.com", "https:", "data:"],
          "form-action": ["'self'"],
          "frame-ancestors": ["'self'"],
          "img-src": ["'self'", "data:"],
          "object-src": ["'none'"],
          "script-src": ["'self'", "https://esm.sh", "https://cdn.tailwindcss.com"],
          "script-src-attr": ["'none'"],
          "style-src": ["'self'", "https://fonts.googleapis.com", "https:", "'unsafe-inline'"],
          "upgrade-insecure-requests": []
        }
      }
    })
  );
  app.use(cors());
  app.use(
    pinoHttp({
      logger,
      customLogLevel(_req, res, error) {
        if (error || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      }
    })
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use("/assets", express.static(path.join(publicDir, "assets")));

  app.get("/", (_req, res) => {
    res.redirect("/dashboard");
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(authRoutes);
  app.use("/admin/api", adminRoutes);
  app.use("/api", apiRoutes);
  app.use("/webhook", webhookRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
