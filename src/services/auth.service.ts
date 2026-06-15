import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { AppUserRole, AppUserStatus, CompanyStatus } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { logger } from "../utils/logger.js";
import { featureFlagService } from "./featureFlag.service.js";

const COOKIE_NAME = "crm_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const PASSWORD_ROUNDS = 12;

export type SessionRole = "ADMIN" | "USER";

export type SessionPayload = {
  userId: string;
  email?: string | null;
  username: string;
  companyId?: string | null;
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

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "company";
}

async function hashPassword(password: string) {
  return bcrypt.hash(password, PASSWORD_ROUNDS);
}

export const authService = {
  cookieName: COOKIE_NAME,

  async hashPassword(password: string) {
    return hashPassword(password);
  },

  async ensureSeedUsers() {
    const company = await prisma.company.upsert({
      where: { slug: "printwear" },
      update: { name: "Printwear", status: CompanyStatus.ACTIVE },
      create: { name: "Printwear", slug: "printwear", status: CompanyStatus.ACTIVE }
    }).catch((error) => {
      logger.warn({ error }, "Company table unavailable; skipping auth seed");
      return null;
    });
    if (company) await featureFlagService.ensureDefaultsForCompany(company.id);

    const adminCount = await prisma.appUser.count({ where: { role: AppUserRole.ADMIN } }).catch((error) => {
      logger.warn({ error }, "AppUser table unavailable; skipping auth seed");
      return 1;
    });

    if (adminCount === 0) {
      if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
        logger.warn("No admin user exists and ADMIN_PASSWORD/SESSION_SECRET are not fully configured");
      } else {
        const adminUsername = env.ADMIN_USERNAME || env.ADMIN_EMAIL?.split("@")[0] || "admin";
        await prisma.appUser.create({
          data: {
            name: env.ADMIN_NAME || "Admin",
            username: adminUsername,
            email: env.ADMIN_EMAIL || null,
            passwordHash: await hashPassword(env.ADMIN_PASSWORD),
            role: AppUserRole.ADMIN,
            status: AppUserStatus.ACTIVE
          }
        });
        logger.info({ adminUsername }, "Database admin user seeded");
      }
    }

    if (company && env.USER_USERNAME && env.USER_PASSWORD) {
      const existingUser = await prisma.appUser.findUnique({ where: { username: env.USER_USERNAME } });
      if (!existingUser) {
        await prisma.appUser.create({
          data: {
            companyId: company.id,
            name: env.USER_NAME || "User",
            username: env.USER_USERNAME,
            email: env.USER_EMAIL || null,
            passwordHash: await hashPassword(env.USER_PASSWORD),
            role: AppUserRole.USER,
            status: AppUserStatus.ACTIVE
          }
        });
        logger.info({ username: env.USER_USERNAME }, "Database default user seeded");
      }
    }
  },

  isConfigured() {
    return Boolean(env.SESSION_SECRET);
  },

  async verifyCredentials(identifier: string, password: string) {
    const value = identifier.trim().toLowerCase();
    const user = await prisma.appUser.findFirst({
      where: {
        OR: [
          { username: { equals: value, mode: "insensitive" } },
          { email: { equals: value, mode: "insensitive" } }
        ]
      }
    });

    if (!user || user.status !== AppUserStatus.ACTIVE) return null;
    if (!(await bcrypt.compare(password, user.passwordHash))) return null;

    await prisma.appUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    return {
      userId: user.id,
      username: user.username,
      email: user.email,
      companyId: user.companyId,
      role: user.role as SessionRole
    };
  },

  createSession(input: Omit<SessionPayload, "exp">) {
    const payload: SessionPayload = {
      ...input,
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
      if (!payload.userId || !payload.username || !["ADMIN", "USER"].includes(payload.role) || payload.exp < Date.now()) {
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
  },

  slugify
};
