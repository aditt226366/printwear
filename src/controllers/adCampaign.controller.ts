import type { Request, Response } from "express";
import { z } from "zod";
import { adCampaignService } from "../services/adCampaign.service.js";
import { asyncHandler } from "../utils/errors.js";
import { sessionCompanyId } from "../utils/tenant.js";

const adStatusSchema = z.enum([
  "DRAFT",
  "READY_TO_PUBLISH",
  "PUBLISHING",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
  "FAILED",
  "MANUALLY_LAUNCHED",
  "CANCELLED"
]);

const objectSchema = z.record(z.unknown()).optional();

const adCampaignSchema = z.object({
  name: z.string().trim().min(2).optional(),
  objective: z.string().trim().min(1).optional(),
  platform: z.string().trim().min(1).optional(),
  status: adStatusSchema.optional(),
  creativeConfig: objectSchema,
  audienceConfig: objectSchema,
  budgetConfig: objectSchema,
  automationConfig: objectSchema,
  trackingConfig: objectSchema
});

const manualLaunchSchema = z.object({
  metaAdId: z.string().trim().min(1),
  metaCampaignId: z.string().trim().optional().nullable(),
  metaAdSetId: z.string().trim().optional().nullable(),
  launchUrl: z.string().trim().optional().nullable()
});

function actorUserId(res: Response) {
  return res.locals.session?.userId ?? null;
}

export const listAppAds = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await adCampaignService.dashboard(sessionCompanyId(res)));
});

export const createAppAd = asyncHandler(async (req: Request, res: Response) => {
  const body = adCampaignSchema.parse(req.body);
  res.status(201).json({ campaign: await adCampaignService.create(sessionCompanyId(res), actorUserId(res), body) });
});

export const getAppAd = asyncHandler(async (req: Request, res: Response) => {
  res.json({ campaign: await adCampaignService.get(sessionCompanyId(res), req.params.id) });
});

export const updateAppAd = asyncHandler(async (req: Request, res: Response) => {
  const body = adCampaignSchema.partial().parse(req.body);
  res.json({ campaign: await adCampaignService.update(sessionCompanyId(res), req.params.id, actorUserId(res), body) });
});

export const launchAppAd = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, campaign: await adCampaignService.launch(sessionCompanyId(res), req.params.id, actorUserId(res)) });
});

export const markAppAdManuallyLaunched = asyncHandler(async (req: Request, res: Response) => {
  const body = manualLaunchSchema.parse(req.body);
  res.json({
    ok: true,
    campaign: await adCampaignService.markManuallyLaunched(sessionCompanyId(res), req.params.id, actorUserId(res), body)
  });
});

export const pauseAppAd = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, campaign: await adCampaignService.changeStatus(sessionCompanyId(res), req.params.id, actorUserId(res), "PAUSED", "ad.paused") });
});

export const resumeAppAd = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, campaign: await adCampaignService.changeStatus(sessionCompanyId(res), req.params.id, actorUserId(res), "RUNNING", "ad.resumed") });
});

export const cancelAppAd = asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, campaign: await adCampaignService.changeStatus(sessionCompanyId(res), req.params.id, actorUserId(res), "CANCELLED", "ad.cancelled") });
});

export const getAppAdAnalytics = asyncHandler(async (req: Request, res: Response) => {
  res.json(await adCampaignService.analytics(sessionCompanyId(res), req.params.id));
});

export const syncAppAdInsights = asyncHandler(async (req: Request, res: Response) => {
  res.json(await adCampaignService.syncInsights(sessionCompanyId(res), req.params.id, actorUserId(res)));
});
