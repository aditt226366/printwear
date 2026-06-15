import type { Request, Response } from "express";
import { LeadStatus, WorkflowTriggerType } from "@prisma/client";
import { z } from "zod";
import { automationService } from "../services/automation.service.js";
import { asyncHandler } from "../utils/errors.js";
import { companyScope, sessionCompanyId } from "../utils/tenant.js";

const audienceSchema = z.object({
  leadIds: z.array(z.string().min(1)).optional(),
  tag: z.string().trim().optional(),
  status: z.nativeEnum(LeadStatus).optional(),
  source: z.string().trim().optional(),
  search: z.string().trim().optional()
});

const contactQuerySchema = z.object({
  search: z.string().trim().optional(),
  tag: z.string().trim().optional(),
  status: z.nativeEnum(LeadStatus).optional(),
  source: z.string().trim().optional()
});

const createContactSchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().min(5),
  tags: z.array(z.string().trim()).optional(),
  source: z.string().trim().optional()
});

const csvImportSchema = z.object({
  csvText: z.string().min(5),
  source: z.string().trim().optional(),
  defaultTags: z.array(z.string().trim()).optional()
});

const bulkSendSchema = z.object({
  name: z.string().trim().min(2),
  templateName: z.string().trim().min(1),
  templateLanguage: z.string().trim().optional(),
  audience: audienceSchema.default({})
});

const campaignSchema = z.object({
  name: z.string().trim().min(2),
  audience: audienceSchema.default({}),
  templateName: z.string().trim().min(1),
  templateLanguage: z.string().trim().optional(),
  messagePreview: z.string().trim().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  scheduleNow: z.boolean().optional()
});

const adDraftSchema = z.object({
  name: z.string().trim().min(2),
  objective: z.string().trim().min(2),
  audience: z.string().trim().min(2),
  headline: z.string().trim().min(2),
  bodyText: z.string().trim().min(2),
  cta: z.string().trim().min(2),
  destinationWhatsAppNumber: z.string().trim().min(5),
  templatePreview: z.string().trim().min(1)
});

const workflowDefinitionSchema = z.object({
  nodes: z.array(z.object({
    id: z.string(),
    type: z.string(),
    label: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    config: z.record(z.unknown()).optional()
  })).default([]),
  edges: z.array(z.object({
    from: z.string(),
    to: z.string()
  })).default([])
});

const workflowSchema = z.object({
  name: z.string().trim().min(2),
  triggerType: z.nativeEnum(WorkflowTriggerType),
  triggerValue: z.string().trim().min(1),
  isActive: z.boolean().optional(),
  definition: workflowDefinitionSchema
});

const workflowUpdateSchema = workflowSchema.partial();

export const getAutomationSetup = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await automationService.setupStatus());
});

export const listContacts = asyncHandler(async (req: Request, res: Response) => {
  const filters = contactQuerySchema.parse(req.query);
  res.json(await automationService.listContacts(filters, companyScope(res)));
});

export const createContact = asyncHandler(async (req: Request, res: Response) => {
  const body = createContactSchema.parse(req.body);
  res.status(201).json({ contact: await automationService.createContact(body, sessionCompanyId(res)) });
});

export const importContactsCsv = asyncHandler(async (req: Request, res: Response) => {
  const body = csvImportSchema.parse(req.body);
  res.json(await automationService.importContactsFromCsv(body, sessionCompanyId(res)));
});

export const importContactsSheets = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await automationService.importContactsFromGoogleSheets(companyScope(res)));
});

export const listBulkJobs = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ jobs: await automationService.listBulkJobs(companyScope(res)) });
});

export const createBulkSend = asyncHandler(async (req: Request, res: Response) => {
  const body = bulkSendSchema.parse(req.body);
  res.status(202).json({ job: await automationService.createBulkSend(body, sessionCompanyId(res)) });
});

export const listCampaigns = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ campaigns: await automationService.listCampaigns(companyScope(res)) });
});

export const getCampaign = asyncHandler(async (req: Request, res: Response) => {
  res.json({ campaign: await automationService.campaignDetail(req.params.campaignId, companyScope(res)) });
});

export const createCampaign = asyncHandler(async (req: Request, res: Response) => {
  const body = campaignSchema.parse(req.body);
  res.status(201).json({
    campaign: await automationService.createCampaign({
      ...body,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null
    }, sessionCompanyId(res))
  });
});

export const pauseCampaign = asyncHandler(async (req: Request, res: Response) => {
  res.json({ campaign: await automationService.pauseCampaign(req.params.campaignId, companyScope(res)) });
});

export const cancelCampaign = asyncHandler(async (req: Request, res: Response) => {
  res.json({ campaign: await automationService.cancelCampaign(req.params.campaignId, companyScope(res)) });
});

export const listAdDrafts = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await automationService.listAdDrafts(companyScope(res)));
});

export const getAdsStatus = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await automationService.metaAdsStatus());
});

export const createAdDraft = asyncHandler(async (req: Request, res: Response) => {
  const body = adDraftSchema.parse(req.body);
  res.status(201).json({ draft: await automationService.createAdDraft(body, sessionCompanyId(res)) });
});

export const listWorkflows = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ workflows: await automationService.listWorkflows(companyScope(res)) });
});

export const createWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const body = workflowSchema.parse(req.body);
  res.status(201).json({ workflow: await automationService.createWorkflow(body, sessionCompanyId(res)) });
});

export const updateWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const body = workflowUpdateSchema.parse(req.body);
  res.json({ workflow: await automationService.updateWorkflow(req.params.workflowId, body, companyScope(res)) });
});
