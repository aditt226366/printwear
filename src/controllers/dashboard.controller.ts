import path from "node:path";
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/errors.js";

const publicDir = path.resolve(process.cwd(), "public");

export const showDashboard = asyncHandler(async (_req: Request, res: Response) => {
  if (res.locals.session?.role === "ADMIN") {
    res.redirect("/admin");
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(publicDir, "dashboard.html"));
});

export const showAdminPanel = asyncHandler(async (_req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(publicDir, "admin.html"));
});
