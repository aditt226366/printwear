import type { NextFunction, Request, Response } from "express";
import { authService } from "../services/auth.service.js";
import { AppError } from "../utils/errors.js";

export function requireSession(req: Request, res: Response, next: NextFunction) {
  const session = authService.readSession(req);
  if (!session) {
    if (req.path.startsWith("/api") || req.originalUrl.startsWith("/admin/api")) {
      res.status(401).json({ error: "Login required" });
      return;
    }

    res.redirect("/login");
    return;
  }

  res.locals.session = session;
  res.locals.admin = session.role === "ADMIN" ? session : null;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireSession(req, res, () => {
    if (res.locals.session?.role !== "ADMIN") {
      if (req.path.startsWith("/api") || req.originalUrl.startsWith("/api/") || req.originalUrl.startsWith("/admin/api")) {
        next(new AppError("Admin access required", 403));
        return;
      }

      res.status(403).send(`
        <!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Admin access required</title>
            <link rel="stylesheet" href="/assets/styles.css?v=20260616-command" />
          </head>
          <body class="login-shell">
            <main class="login-page">
              <section class="login-panel">
                <div class="login-brand">
                  <span class="brand-mark">PA</span>
                  <div>
                    <p class="eyebrow">Platform Administration</p>
                    <h1>Admin access required</h1>
                  </div>
                </div>
                <p class="login-subtitle">This area is only available to platform administrators.</p>
                <div class="form-actions">
                  <a class="secondary-button" href="/dashboard">Open command center</a>
                  <form action="/logout" method="post"><button class="primary-button" type="submit">Switch account</button></form>
                </div>
              </section>
            </main>
          </body>
        </html>
      `);
      return;
    }

    next();
  });
}
