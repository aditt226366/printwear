import type { Request, Response } from "express";
import { commandCenterService } from "../services/commandCenter.service.js";
import { asyncHandler } from "../utils/errors.js";
import { companyScope } from "../utils/tenant.js";

export const getCommandCenter = asyncHandler(async (req: Request, res: Response) => {
  res.json(await commandCenterService.snapshot(companyScope(res), req.query.segment));
});
