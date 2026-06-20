import type { NextFunction, Request, Response } from "express";
import { featureFlagService, type FeatureKey } from "../services/featureFlag.service.js";
import { AppError } from "../utils/errors.js";

export function requireFeature(key: FeatureKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (res.locals.session?.role === "ADMIN") {
        next();
        return;
      }

      if (await featureFlagService.isEnabled(key, res.locals.session?.companyId)) {
        next();
        return;
      }

      next(new AppError("Feature disabled by admin.", 403, {
        code: "FEATURE_DISABLED",
        feature: key,
        message: "Feature disabled by admin."
      }));
    } catch (error) {
      next(error);
    }
  };
}
