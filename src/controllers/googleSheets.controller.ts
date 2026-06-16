import type { Request, Response } from "express";
import { googleSheetsService } from "../services/googleSheets.service.js";
import { asyncHandler } from "../utils/errors.js";

export const getGoogleSheetsStatus = asyncHandler(async (req: Request, res: Response) => {
  const companyId = typeof req.query.companyId === "string" && req.query.companyId.trim()
    ? req.query.companyId.trim()
    : res.locals.session?.companyId ?? null;

  res.json(await googleSheetsService.status(companyId));
});
