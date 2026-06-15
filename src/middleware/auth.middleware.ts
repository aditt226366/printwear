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
  res.locals.admin = session.role === "admin" ? session : null;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireSession(req, res, () => {
    if (res.locals.session?.role !== "admin") {
      next(new AppError("Admin access required", 403));
      return;
    }

    next();
  });
}
