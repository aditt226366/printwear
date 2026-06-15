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
      email: res.locals.session.email,
      role: res.locals.session.role
    }
  });
});

export const getEnabledFeatures = asyncHandler(async (_req: Request, res: Response) => {
  const session = res.locals.session;
  const features = session.role === "admin" ? await featureFlagService.list() : await featureFlagService.enabledForUser();
  res.json({ features });
});

export const getAdminFeatures = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ features: await featureFlagService.list() });
});

export const updateAdminFeature = asyncHandler(async (req: Request, res: Response) => {
  const body = featureUpdateSchema.parse(req.body);
  const feature = await featureFlagService.update(req.params.key, body.enabled);
  res.json({ feature, features: await featureFlagService.list() });
});
