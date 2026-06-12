import type { Request, Response } from "express";
import { importLeadsJob } from "../jobs/importLeads.job.js";
import { AppError, asyncHandler } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export const importLeads = asyncHandler(async (_req: Request, res: Response) => {
  try {
    const result = await importLeadsJob();
    res.json(result);
  } catch (error) {
    const statusCode = error instanceof AppError ? error.statusCode : 500;
    const message = error instanceof AppError ? error.message : "Lead import failed";
    const details = error instanceof AppError
      ? error.details
      : "Unexpected lead import failure. Check server logs for the full error.";

    logger.error({ error }, "Lead import API failed");
    res.status(statusCode).json({
      success: false,
      error: message,
      details
    });
  }
});
