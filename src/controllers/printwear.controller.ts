import type { Request, Response } from "express";
import { z } from "zod";
import { dashboardService } from "../services/dashboard.service.js";
import { printwearAIAgentService } from "../services/printwearAIAgent.service.js";
import { printwearDashboardService } from "../services/printwearDashboard.service.js";
import { printwearHumanQueueService } from "../services/printwearHumanQueue.service.js";
import { printwearIntegrationService } from "../services/printwearIntegration.service.js";
import { printwearOrderService } from "../services/printwearOrder.service.js";
import { printwearSheetService } from "../services/printwearSheet.service.js";
import { printwearTemplateSendService } from "../services/printwearTemplateSend.service.js";
import { companyIntegrationService } from "../services/companyIntegration.service.js";
import { asyncHandler, AppError } from "../utils/errors.js";
import { sessionCompanyId } from "../utils/tenant.js";

const importAndSendSchema = z.object({
  confirm: z.boolean().optional()
});

const knowledgeIndexSchema = z.object({
  websiteUrl: z.string().trim().url().optional()
});

const testSchema = z.object({
  prompt: z.string().trim().min(1).max(400).optional()
});

function printwearTenantId(res: Response) {
  return String(res.locals.printwearTenantId || sessionCompanyId(res));
}

function webhookBaseUrl(req: Request) {
  const protocol = req.get("x-forwarded-proto") ?? req.protocol;
  const host = req.get("host") ?? "localhost";
  return `${protocol}://${host}`;
}

export const getPrintwearDashboard = asyncHandler(async (req: Request, res: Response) => {
  res.json(await printwearDashboardService.dashboard(printwearTenantId(res), webhookBaseUrl(req)));
});

export const getPrintwearIntegrationStatus = asyncHandler(async (req: Request, res: Response) => {
  res.json({ status: await printwearIntegrationService.status(printwearTenantId(res), webhookBaseUrl(req)) });
});

export const syncPrintwearSheet = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await printwearSheetService.syncLeads(printwearTenantId(res)));
});

export const importAndSendPrintwearTemplate = asyncHandler(async (req: Request, res: Response) => {
  const body = importAndSendSchema.parse(req.body ?? {});
  res.json(await printwearTemplateSendService.importAndSendApprovedTemplate(printwearTenantId(res), body));
});

export const getPrintwearLeads = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ leads: await printwearDashboardService.leads(printwearTenantId(res)) });
});

export const getPrintwearOrders = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ orders: await printwearOrderService.list(printwearTenantId(res)) });
});

export const getPrintwearHumanQueue = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ items: await printwearHumanQueueService.list(printwearTenantId(res)) });
});

export const indexPrintwearKnowledgeBase = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = printwearTenantId(res);
  const body = knowledgeIndexSchema.parse(req.body ?? {});
  let websiteUrl = body.websiteUrl;

  if (!websiteUrl) {
    const { config } = await companyIntegrationService.resolveConfigForVerification(tenantId, "KNOWLEDGE_BASE");
    websiteUrl = typeof config.websiteUrl === "string" ? config.websiteUrl : undefined;
  }

  const results: Record<string, unknown> = {};
  if (websiteUrl) {
    results.website = await dashboardService.ingestWebsite(websiteUrl, tenantId);
  }
  if (req.file) {
    if (req.file.mimetype !== "application/pdf") throw new AppError("PDF file wrong", 400);
    results.upload = await dashboardService.ingestUploadedKnowledge({
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
      companyId: tenantId,
      title: req.body.title,
      category: req.body.category || "printwear_uploaded_knowledge"
    });
  }
  if (!websiteUrl && !req.file) {
    throw new AppError("Company website wrong", 400);
  }

  res.json({ status: "INDEXED", results });
});

export const testPrintwearKnowledgeBase = asyncHandler(async (req: Request, res: Response) => {
  const body = testSchema.parse(req.body ?? {});
  const result = await printwearAIAgentService.test(printwearTenantId(res), body.prompt || "Reply with OK.");
  res.json(result);
});

export const testPrintwearAI = asyncHandler(async (req: Request, res: Response) => {
  const body = testSchema.parse(req.body ?? {});
  const result = await printwearAIAgentService.test(printwearTenantId(res), body.prompt || "Reply with OK.");
  res.json(result);
});
