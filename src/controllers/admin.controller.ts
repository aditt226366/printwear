import type { Request, Response } from "express";
import { OrderStatus } from "@prisma/client";
import { z } from "zod";
import { importLeadsJob } from "../jobs/importLeads.job.js";
import { sendInitialMessagesJob } from "../jobs/sendInitialMessages.job.js";
import { dashboardService } from "../services/dashboard.service.js";
import { chatEventsService } from "../services/chatEvents.service.js";
import { humanActionService } from "../services/humanAction.service.js";
import { orderActionService } from "../services/orderAction.service.js";
import { orderSummaryService } from "../services/orderSummary.service.js";
import { asyncHandler, AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const knowledgeSchema = z.object({
  title: z.string().trim().min(2),
  category: z.string().trim().min(2),
  content: z.string().trim().min(10)
});

const websiteIngestSchema = z.object({
  url: z.string().trim().url()
});

const manualMessageSchema = z.object({
  text: z.string().trim().min(1).max(700)
});

const leadQuerySchema = z.object({
  search: z.string().trim().optional(),
  temperature: z.enum(["HOT", "WARM", "SCRAP"]).optional()
});

const orderStatusSchema = z.object({
  status: z.nativeEnum(OrderStatus)
});

const orderUpdateSchema = z.object({
  productType: z.string().trim().nullable().optional(),
  quantity: z.coerce.number().int().positive().nullable().optional(),
  size: z.string().trim().nullable().optional(),
  color: z.string().trim().nullable().optional(),
  gsm: z.string().trim().nullable().optional(),
  customization: z.string().trim().nullable().optional(),
  deliveryLocation: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  confidenceScore: z.coerce.number().min(0).max(1).nullable().optional()
});

const orderActionSchema = z.object({
  action: z.enum(["CONFIRM", "READY_FOR_DISPATCH", "DISPATCH", "CANCEL"])
});

export const getOverview = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await dashboardService.overview());
});

function emptyDashboardResponse() {
  const pipeline = Object.fromEntries(Object.values(OrderStatus).map((status) => [status, []]));

  return {
    totalLeads: 0,
    hotLeads: 0,
    warmLeads: 0,
    scrapLeads: 0,
    inboundMessages: 0,
    outboundMessages: 0,
    recentConversations: [],
    recentLeads: [],
    recentLogs: [],
    humanActionQueue: [],
    orderPipeline: pipeline,
    pipeline,
    stats: {
      totalLeads: 0,
      hotLeads: 0,
      warmLeads: 0,
      scrapLeads: 0,
      inboundMessages: 0,
      outboundMessages: 0
    }
  };
}

export const getDashboard = asyncHandler(async (_req: Request, res: Response) => {
  const fallback = emptyDashboardResponse();
  const [overviewResult, queueResult, pipelineResult] = await Promise.allSettled([
    dashboardService.overview(),
    humanActionService.listQueue(),
    orderSummaryService.listPipeline()
  ]);

  if (overviewResult.status === "rejected") {
    logger.error({ error: overviewResult.reason }, "Dashboard overview query failed");
  }
  if (queueResult.status === "rejected") {
    logger.error({ error: queueResult.reason }, "Dashboard human action queue query failed");
  }
  if (pipelineResult.status === "rejected") {
    logger.error({ error: pipelineResult.reason }, "Dashboard order pipeline query failed");
  }

  const overview = overviewResult.status === "fulfilled" ? overviewResult.value : fallback;
  const stats = overview.stats ?? fallback.stats;
  const recentLeads = overview.recentLeads ?? [];
  const humanActionQueue = queueResult.status === "fulfilled" ? queueResult.value : [];
  const orderPipeline = pipelineResult.status === "fulfilled" ? pipelineResult.value : fallback.orderPipeline;

  res.json({
    ...overview,
    stats,
    totalLeads: stats.totalLeads ?? 0,
    hotLeads: stats.hotLeads ?? 0,
    warmLeads: stats.warmLeads ?? 0,
    scrapLeads: stats.scrapLeads ?? 0,
    inboundMessages: stats.inboundMessages ?? 0,
    outboundMessages: stats.outboundMessages ?? 0,
    recentConversations: recentLeads,
    recentLeads,
    humanActionQueue,
    orderPipeline,
    pipeline: orderPipeline
  });
});

export const streamChatEvents = asyncHandler(async (_req: Request, res: Response) => {
  chatEventsService.subscribe(res);
});

export const getLeads = asyncHandler(async (req: Request, res: Response) => {
  const filters = leadQuerySchema.parse(req.query);
  res.json({ leads: await dashboardService.listLeads(filters) });
});

export const getConversation = asyncHandler(async (req: Request, res: Response) => {
  const conversation = await dashboardService.conversation(req.params.leadId);
  if (!conversation) {
    throw new AppError("Lead not found", 404);
  }

  res.json(conversation);
});

export const sendManualMessage = asyncHandler(async (req: Request, res: Response) => {
  const body = manualMessageSchema.parse(req.body);
  const message = await dashboardService.sendManualMessage(req.params.leadId, body.text);
  res.json({ message });
});

export const getHumanActionQueue = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ items: await humanActionService.listQueue() });
});

export const resolveHumanAction = asyncHandler(async (req: Request, res: Response) => {
  const lead = await humanActionService.resolve(req.params.leadId);
  res.json({ lead });
});

export const getOrderPipeline = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ pipeline: await orderSummaryService.listPipeline() });
});

export const updateOrderStatus = asyncHandler(async (req: Request, res: Response) => {
  const body = orderStatusSchema.parse(req.body);
  const order = await orderSummaryService.updateStatus(req.params.orderId, body.status);
  res.json({ order });
});

export const updateOrder = asyncHandler(async (req: Request, res: Response) => {
  const body = orderUpdateSchema.parse(req.body);
  const order = await orderSummaryService.updateOrder(req.params.orderId, body);
  res.json({ order });
});

export const performOrderAction = asyncHandler(async (req: Request, res: Response) => {
  const body = orderActionSchema.parse(req.body);
  res.json(await orderActionService.perform(req.params.orderId, body.action));
});

export const importLeads = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await importLeadsJob());
});

export const sendInitialMessages = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await sendInitialMessagesJob());
});

export const getKnowledge = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ entries: await dashboardService.listKnowledge() });
});

export const createKnowledge = asyncHandler(async (req: Request, res: Response) => {
  const body = knowledgeSchema.parse(req.body);
  const entry = await dashboardService.createKnowledge(body);
  res.status(201).json({ entry });
});

export const updateKnowledge = asyncHandler(async (req: Request, res: Response) => {
  const body = knowledgeSchema.parse(req.body);
  const entry = await dashboardService.updateKnowledge(req.params.id, body);
  res.json({ entry });
});

export const deleteKnowledge = asyncHandler(async (req: Request, res: Response) => {
  await dashboardService.deleteKnowledge(req.params.id);
  res.status(204).send();
});

export const ingestWebsiteKnowledge = asyncHandler(async (req: Request, res: Response) => {
  const body = websiteIngestSchema.parse(req.body);
  const result = await dashboardService.ingestWebsite(body.url);
  res.json(result);
});

export const syncPrintwearWebsiteKnowledge = asyncHandler(async (_req: Request, res: Response) => {
  const result = await dashboardService.syncPrintwearWebsite();
  res.json(result);
});

export const uploadKnowledgeDocument = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new AppError("Upload a PDF, DOCX, or TXT file", 400);
  }

  const result = await dashboardService.ingestUploadedKnowledge({
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    buffer: req.file.buffer,
    title: typeof req.body.title === "string" ? req.body.title : undefined,
    category: typeof req.body.category === "string" ? req.body.category : undefined
  });

  res.json(result);
});

export const getLogs = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ logs: await dashboardService.listLogs() });
});

export const getEnums = asyncHandler(async (_req: Request, res: Response) => {
  res.json(dashboardService.enums());
});
