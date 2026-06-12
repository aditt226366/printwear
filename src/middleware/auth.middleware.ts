import type { NextFunction, Request, Response } from "express";
import { authService } from "../services/auth.service.js";

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = authService.readSession(req);
  if (!session) {
    if (req.path.startsWith("/api") || req.originalUrl.startsWith("/admin/api")) {
      res.status(401).json({ error: "Admin login required" });
      return;
    }

    res.redirect("/login");
    return;
  }

  res.locals.admin = session;
  next();
}
