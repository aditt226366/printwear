import type { Request, Response } from "express";
import { knowledgeService } from "../services/knowledge.service.js";
import { asyncHandler } from "../utils/errors.js";

export const seedKnowledgeBase = asyncHandler(async (_req: Request, res: Response) => {
  const result = await knowledgeService.seedDefaults();
  res.json(result);
});

export const listKnowledgeBase = asyncHandler(async (_req: Request, res: Response) => {
  const entries = await knowledgeService.list();
  res.json({ entries });
});
