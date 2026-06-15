import crypto from "node:crypto";
import type { Request, Response } from "express";
import { env } from "../config/env.js";

const COOKIE_NAME = "crm_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export type SessionRole = "admin" | "user";

export type SessionPayload = {
  email: string;
  role: SessionRole;
  exp: number;
};

function base64Url(input: string) {
  return Buffer.from(input).toString("base64url");
}

function fromBase64Url(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(value: string) {
  const secret = env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured");
  }

  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function readCookie(req: Request, name: string) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return undefined;
  }

  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export const authService = {
  cookieName: COOKIE_NAME,

  isConfigured() {
    return Boolean(env.ADMIN_EMAIL && env.ADMIN_PASSWORD && env.SESSION_SECRET);
  },

  isUserConfigured() {
    return Boolean(env.USER_EMAIL && env.USER_PASSWORD && env.SESSION_SECRET);
  },

  verifyCredentials(email: string, password: string) {
    if (!this.isConfigured()) {
      throw new Error("Admin login is not configured. Set ADMIN_EMAIL, ADMIN_PASSWORD, and SESSION_SECRET.");
    }

    if (safeEqual(email, env.ADMIN_EMAIL ?? "") && safeEqual(password, env.ADMIN_PASSWORD ?? "")) {
      return "admin" as const;
    }

    if (this.isUserConfigured() && safeEqual(email, env.USER_EMAIL ?? "") && safeEqual(password, env.USER_PASSWORD ?? "")) {
      return "user" as const;
    }

    return null;
  },

  createSession(email: string, role: SessionRole) {
    const payload: SessionPayload = {
      email,
      role,
      exp: Date.now() + SESSION_TTL_MS
    };
    const encodedPayload = base64Url(JSON.stringify(payload));
    return `${encodedPayload}.${sign(encodedPayload)}`;
  },

  readSession(req: Request): SessionPayload | null {
    const token = readCookie(req, COOKIE_NAME);
    if (!token || !env.SESSION_SECRET) {
      return null;
    }

    try {
      const [encodedPayload, signature] = token.split(".");
      if (!encodedPayload || !signature || !safeEqual(signature, sign(encodedPayload))) {
        return null;
      }

      const payload = JSON.parse(fromBase64Url(encodedPayload)) as SessionPayload;
      if (!payload.email || !["admin", "user"].includes(payload.role) || payload.exp < Date.now()) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  },

  setSessionCookie(res: Response, token: string) {
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_TTL_MS,
      path: "/"
    });
  },

  clearSessionCookie(res: Response) {
    res.clearCookie(COOKIE_NAME, { path: "/" });
  }
};
