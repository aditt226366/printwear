import type { Request, Response } from "express";
import { z } from "zod";
import { featureFlagService } from "../services/featureFlag.service.js";
import { asyncHandler } from "../utils/errors.js";

const featureUpdateSchema = z.object({
  enabled: z.boolean()
});

export const getSession = asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    session: {
      userId: res.locals.session.userId,
      email: res.locals.session.email,
      username: res.locals.session.username,
      companyId: res.locals.session.companyId,
      role: res.locals.session.role
    }
  });
});

export const getEnabledFeatures = asyncHandler(async (_req: Request, res: Response) => {
  const session = res.locals.session;
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
