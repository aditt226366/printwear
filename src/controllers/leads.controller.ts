import type { Request, Response } from "express";
import { importLeadsJob } from "../jobs/importLeads.job.js";
import { asyncHandler } from "../utils/errors.js";

export const importLeads = asyncHandler(async (_req: Request, res: Response) => {
  const result = await importLeadsJob();
  res.json(result);
});
