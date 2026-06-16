import type { Request, Response } from "express";
import { systemStatusService } from "../services/systemStatus.service.js";
import { asyncHandler } from "../utils/errors.js";
import { integrationConfigDiagnostic } from "../utils/integrationConfig.js";

export const getSystemStatus = asyncHandler(async (_req: Request, res: Response) => {
  const status = await systemStatusService.getStatus();
  res.status(status.databaseConnected ? 200 : 503).json(status);
});

export const getDatabaseSchema = asyncHandler(async (_req: Request, res: Response) => {
  const status = await systemStatusService.databaseSchema();
  res.status(status.databaseConnected ? 200 : 503).json(status);
});

export const getIntegrationConfig = asyncHandler(async (_req: Request, res: Response) => {
  res.json(integrationConfigDiagnostic());
});
