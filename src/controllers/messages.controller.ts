import type { Request, Response } from "express";
import { sendInitialMessagesJob } from "../jobs/sendInitialMessages.job.js";
import { asyncHandler } from "../utils/errors.js";

export const sendInitialMessages = asyncHandler(async (_req: Request, res: Response) => {
  const result = await sendInitialMessagesJob();
  res.json(result);
});
