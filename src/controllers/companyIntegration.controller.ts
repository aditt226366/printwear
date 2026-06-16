import type { Request, Response } from "express";
import { z } from "zod";
import { companyIntegrationService } from "../services/companyIntegration.service.js";
import { googleSheetsService } from "../services/googleSheets.service.js";
import { asyncHandler } from "../utils/errors.js";
import { sessionCompanyId } from "../utils/tenant.js";

const integrationSchema = z.object({
  companyId: z.string().trim().min(1),
  googleSheetsId: z.string().trim().optional().nullable(),
  googleServiceAccountEmail: z.string().trim().optional().nullable(),
  googlePrivateKey: z.string().optional().nullable(),
  whatsappPhoneNumberId: z.string().trim().optional().nullable(),
  whatsappBusinessAccountId: z.string().trim().optional().nullable(),
  whatsappAccessToken: z.string().optional().nullable(),
  whatsappVerifyToken: z.string().trim().optional().nullable(),
  whatsappDefaultTemplateName: z.string().trim().optional().nullable(),
  whatsappTemplateLanguage: z.string().trim().optional().nullable(),
  metaAdAccountId: z.string().trim().optional().nullable(),
  metaAdsAccessToken: z.string().optional().nullable()
});

const providerMap = {
  "google-sheets": "googleSheets",
  whatsapp: "whatsapp",
  "meta-ads": "metaAds"
} as const;

export const getCompanyIntegration = asyncHandler(async (req: Request, res: Response) => {
  const companyId = String(req.query.companyId || "").trim();
  res.json({ integration: await companyIntegrationService.listAdmin(companyId) });
});

export const updateCompanyIntegration = asyncHandler(async (req: Request, res: Response) => {
  const body = integrationSchema.parse(req.body);
  res.json({ integration: await companyIntegrationService.updateAdmin(body.companyId, body) });
});

export const clearCompanyIntegrationProvider = asyncHandler(async (req: Request, res: Response) => {
  const provider = providerMap[req.params.provider as keyof typeof providerMap];
  if (!provider) {
    res.status(400).json({ error: "Unknown integration provider." });
    return;
  }
  res.json({ integration: await companyIntegrationService.clearProvider(req.params.companyId, provider) });
});

export const getIntegrationStatus = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ integration: await companyIntegrationService.userStatus(sessionCompanyId(res)) });
});

export const testWhatsAppIntegration = asyncHandler(async (req: Request, res: Response) => {
  res.json({ test: await companyIntegrationService.testWhatsApp(req.params.companyId) });
});

export const testGoogleSheetsIntegration = asyncHandler(async (req: Request, res: Response) => {
  res.json({ test: await googleSheetsService.status(req.params.companyId) });
});

export const testMetaAdsIntegration = asyncHandler(async (req: Request, res: Response) => {
  res.json({ test: await companyIntegrationService.testMetaAds(req.params.companyId) });
});
