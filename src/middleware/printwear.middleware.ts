import type { NextFunction, Request, Response } from "express";
import { CompanyStatus } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { printwearTenantService } from "../services/printwearTenant.service.js";
import { AppError, asyncHandler } from "../utils/errors.js";
import { sessionCompanyId } from "../utils/tenant.js";

export const requireTenantUser = asyncHandler(async (_req: Request, res: Response, next: NextFunction) => {
  if (res.locals.session?.role === "ADMIN") {
    throw new AppError("User workspace access required", 403);
  }

  sessionCompanyId(res);
  next();
});

export const requireActiveTenant = asyncHandler(async (_req: Request, res: Response, next: NextFunction) => {
  const companyId = sessionCompanyId(res);
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { status: true }
  });

  if (!company || company.status !== CompanyStatus.ACTIVE) {
    throw new AppError("Tenant is not active", 403);
  }

  next();
});

export const requirePrintwearTenant = asyncHandler(async (_req: Request, res: Response, next: NextFunction) => {
  const companyId = sessionCompanyId(res);
  if (!await printwearTenantService.isPrintwearTenant(companyId)) {
    throw new AppError("Printwear tenant access required", 403);
  }

  res.locals.printwearTenantId = companyId;
  next();
});
