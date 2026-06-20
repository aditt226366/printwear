import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { featureFlagService } from "../services/featureFlag.service.js";
import { printwearTenantService } from "../services/printwearTenant.service.js";
import { asyncHandler } from "../utils/errors.js";

const featureUpdateSchema = z.object({
  enabled: z.boolean()
});

export const getSession = asyncHandler(async (_req: Request, res: Response) => {
  const company = res.locals.session.companyId
    ? await prisma.company.findUnique({
        where: { id: res.locals.session.companyId },
        select: { id: true, name: true, slug: true, logoUrl: true, brandColor: true, whatsappNumber: true, timezone: true, businessType: true }
      })
    : null;
  const isPrintwearTenant = await printwearTenantService.isPrintwearTenant(res.locals.session.companyId);
  res.json({
    session: {
      userId: res.locals.session.userId,
      email: res.locals.session.email,
      username: res.locals.session.username,
      companyId: res.locals.session.companyId,
      role: res.locals.session.role,
      isPrintwearTenant,
      company
    }
  });
});

export const getEnabledFeatures = asyncHandler(async (_req: Request, res: Response) => {
  const session = res.locals.session;
  if (session.role !== "ADMIN" && !session.companyId) {
    res.status(409).json({ error: "Company context missing. Please contact admin.", code: "COMPANY_CONTEXT_MISSING", features: [] });
    return;
  }
  const features = session.role === "ADMIN" ? await featureFlagService.list(session.companyId) : await featureFlagService.enabledForUser(session.companyId);
  res.json({ features });
});

export const getAdminFeatures = asyncHandler(async (req: Request, res: Response) => {
  const companyId = String(req.query.companyId || "");
  res.json({ features: await featureFlagService.list(companyId) });
});

export const updateAdminFeature = asyncHandler(async (req: Request, res: Response) => {
  const body = featureUpdateSchema.parse(req.body);
  const feature = await featureFlagService.update(req.params.key, body.enabled);
  res.json({ feature });
});
