import type { Response } from "express";
import { AppError } from "./errors.js";

export function sessionCompanyId(res: Response) {
  const companyId = res.locals.session?.companyId;
  if (!companyId) throw new AppError("Company context is required.", 403);
  return String(companyId);
}

export function companyScope(res: Response) {
  if (res.locals.session?.role === "ADMIN") return undefined;
  return sessionCompanyId(res);
}
