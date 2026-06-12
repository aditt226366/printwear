import path from "node:path";
import type { Request, Response } from "express";
import { authService } from "../services/auth.service.js";
import { asyncHandler, AppError } from "../utils/errors.js";

const publicDir = path.resolve(process.cwd(), "public");

export const showLogin = asyncHandler(async (req: Request, res: Response) => {
  const session = authService.readSession(req);
  if (session) {
    res.redirect("/dashboard");
    return;
  }

  res.sendFile(path.join(publicDir, "login.html"));
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const password = String(req.body.password ?? "");

  if (!email || !password) {
    throw new AppError("Email and password are required", 400);
  }

  if (!authService.isConfigured()) {
    throw new AppError("Admin login is not configured. Set ADMIN_EMAIL, ADMIN_PASSWORD, and SESSION_SECRET.", 500);
  }

  if (!authService.verifyCredentials(email, password)) {
    throw new AppError("Invalid admin email or password", 401);
  }

  const session = authService.createSession(email);
  authService.setSessionCookie(res, session);
  res.json({ ok: true });
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  authService.clearSessionCookie(res);
  res.redirect("/login");
});
