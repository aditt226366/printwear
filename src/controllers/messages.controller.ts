import type { Request, Response } from "express";
import { sendInitialMessagesJob } from "../jobs/sendInitialMessages.job.js";
import { AppError, asyncHandler } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export const sendInitialMessages = asyncHandler(async (_req: Request, res: Response) => {
  try {
    const result = await sendInitialMessagesJob();
    res.json(result);
  } catch (error) {
    const statusCode = error instanceof AppError ? error.statusCode : 500;
    const message = error instanceof AppError ? error.message : "Welcome message send failed";
    const details = error instanceof AppError
      ? error.details
      : "Unexpected welcome message failure. Check server logs for the full error.";

    logger.error({ error }, "Send initial messages API failed");
    res.status(statusCode).json({
      success: false,
      error: message,
      details
    });
  }
});
