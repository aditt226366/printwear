import type { Request, Response } from "express";
import { systemStatusService } from "../services/systemStatus.service.js";
import { asyncHandler } from "../utils/errors.js";

export const getSystemStatus = asyncHandler(async (_req: Request, res: Response) => {
  const status = await systemStatusService.getStatus();
  res.status(status.databaseConnected ? 200 : 503).json(status);
});
