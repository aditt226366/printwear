import path from "node:path";
import type { Request, Response } from "express";
import { authService } from "../services/auth.service.js";
import { asyncHandler, AppError } from "../utils/errors.js";

const publicDir = path.resolve(process.cwd(), "public");
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function loginAttemptKey(req: Request, username: string) {
  return `${req.ip || req.socket.remoteAddress || "unknown"}:${username.toLowerCase()}`;
}

function assertLoginAllowed(req: Request, username: string) {
  const key = loginAttemptKey(req, username);
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  if (current.count >= LOGIN_MAX_ATTEMPTS) {
    throw new AppError("Invalid username or password", 401);
  }
}

function recordLoginFailure(req: Request, username: string) {
  const key = loginAttemptKey(req, username);
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  current.count += 1;
}

function clearLoginFailures(req: Request, username: string) {
  loginAttempts.delete(loginAttemptKey(req, username));
}

export const showLogin = asyncHandler(async (req: Request, res: Response) => {
  const session = authService.readSession(req);
  if (session) {
    res.redirect(session.role === "ADMIN" ? "/admin" : "/dashboard");
    return;
  }

  res.sendFile(path.join(publicDir, "login.html"));
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const username = String(req.body.username ?? req.body.email ?? "").trim();
  const password = String(req.body.password ?? "");

  if (!username || !password) {
    throw new AppError("Invalid username or password", 401);
  }

  if (!authService.isConfigured()) {
    throw new AppError("Login is not configured.", 500);
  }

  assertLoginAllowed(req, username);
  let user: Awaited<ReturnType<typeof authService.verifyCredentials>>;
  try {
    user = await authService.verifyCredentials(username, password);
  } catch {
    throw new AppError("Login service unavailable. Please try again.", 503);
  }
  if (!user) {
    recordLoginFailure(req, username);
    throw new AppError("Invalid username or password", 401);
  }

  clearLoginFailures(req, username);
  const session = authService.createSession(user);
  authService.setSessionCookie(res, session);
  res.json({ ok: true, role: user.role, redirectTo: user.role === "ADMIN" ? "/admin" : "/dashboard" });
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  authService.clearSessionCookie(res);
  res.redirect("/login");
});
