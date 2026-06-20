import { MessageDirection, MessageStatus, MessageType } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { printwearHumanQueueService } from "./printwearHumanQueue.service.js";
import { printwearIntegrationService } from "./printwearIntegration.service.js";
import { printwearLeadScoringService } from "./printwearLeadScoring.service.js";
import { printwearOrderService } from "./printwearOrder.service.js";

function temperatureFromCount(count: number) {
  if (count >= 6) return "HOT";
  if (count >= 2) return "WARM";
  return "SCRAP";
}

function leadDto(lead: {
  id: string;
  name: string;
  phone: string;
  source: string;
  status: string;
  messageCount: number;
  leadTemperature: string;
  temperatureReason: string;
  updatedAt: Date;
  googleSheetRowNumber: number | null;
  humanTakeoverRequired?: boolean;
  humanReason?: string | null;
  humanPriority?: string | null;
  humanResolvedAt?: Date | null;
  messages?: Array<{ content: string; direction: string; status: string; createdAt: Date }>;
  orderSummary?: unknown;
}) {
  const lastMessage = lead.messages?.[0];
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    source: lead.source,
    status: lead.status,
    optIn: true,
    templateStatus: lead.status === "MESSAGED" ? "SENT" : lead.status === "FAILED" ? "FAILED" : "NOT_SENT",
    messageStatus: lastMessage?.status ?? "--",
    customerReplyCount: lead.messageCount,
    messageCount: lead.messageCount,
    leadTemperature: temperatureFromCount(lead.messageCount),
    temperature: temperatureFromCount(lead.messageCount),
    temperatureReason: lead.temperatureReason,
    lastMessage: lastMessage?.content ?? "No messages yet",
    lastMessageAt: lastMessage?.createdAt ?? lead.updatedAt,
    orderSummary: lead.orderSummary,
    orderStatus: (lead.orderSummary as { status?: string } | null)?.status ?? "--",
    humanQueueStatus: lead.humanTakeoverRequired && !lead.humanResolvedAt ? lead.humanReason || "Waiting" : "Clear",
    humanTakeoverRequired: lead.humanTakeoverRequired,
    humanReason: lead.humanReason,
    humanPriority: lead.humanPriority,
    humanResolvedAt: lead.humanResolvedAt,
    error: "",
    googleSheetRowNumber: lead.googleSheetRowNumber
  };
}

export const printwearDashboardService = {
  async dashboard(tenantId: string, webhookBaseUrl?: string) {
    const [strictMetrics, integrationStatus, templatesSent, repliesReceived, aiRepliesSent, ordersStats, humanQueue, failedMessages, recentLeads, recentReplies, recentErrors] = await Promise.all([
      printwearLeadScoringService.updateDashboardMetrics(tenantId),
      printwearIntegrationService.status(tenantId, webhookBaseUrl),
      prisma.message.count({ where: { lead: { companyId: tenantId }, direction: MessageDirection.OUTBOUND, type: MessageType.TEMPLATE } }),
      prisma.message.count({ where: { lead: { companyId: tenantId }, direction: MessageDirection.INBOUND } }),
      prisma.sendLog.count({ where: { lead: { companyId: tenantId }, action: "printwear_ai_reply", status: "sent" } }),
      printwearOrderService.stats(tenantId),
      printwearHumanQueueService.list(tenantId),
      prisma.message.count({ where: { lead: { companyId: tenantId }, status: MessageStatus.FAILED } }),
      prisma.lead.findMany({
        where: { companyId: tenantId },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { orderSummary: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } }
      }),
      prisma.message.findMany({
        where: { lead: { companyId: tenantId }, direction: MessageDirection.INBOUND },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { lead: true }
      }),
      prisma.sendLog.findMany({
        where: { lead: { companyId: tenantId }, status: "failed" },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { lead: true }
      })
    ]);

    const lastTemplate = await prisma.message.findFirst({
      where: { lead: { companyId: tenantId }, direction: MessageDirection.OUTBOUND, type: MessageType.TEMPLATE },
      orderBy: { createdAt: "desc" }
    });
    const lastAIReply = await prisma.message.findFirst({
      where: { lead: { companyId: tenantId }, direction: MessageDirection.OUTBOUND, type: MessageType.TEXT },
      orderBy: { createdAt: "desc" }
    });

    return {
      stats: {
        ...strictMetrics,
        templatesSent,
        repliesReceived,
        aiRepliesSent,
        ordersCaptured: ordersStats.ordersCaptured,
        humanQueue: humanQueue.length,
        failedMessages,
        googleSheetSyncStatus: integrationStatus.googleSheets.connected ? "Connected" : "Not Connected",
        whatsappCoexistenceStatus: integrationStatus.whatsappCloud.coexistenceStatus || "Not Confirmed"
      },
      workflowStatus: {
        googleSheets: integrationStatus.googleSheets.connected ? "Connected" : "Not Connected",
        whatsappCloud: integrationStatus.whatsappCloud.connected ? "Connected" : "Not Connected",
        templateSettings: integrationStatus.templateSettings.connected ? "Ready" : "Missing",
        claude: integrationStatus.aiModel.connected ? "Connected" : "Not Connected",
        knowledgeBase: integrationStatus.knowledgeBase.connected ? "Indexed" : "Not Indexed",
        lastSheetSync: recentLeads[0]?.updatedAt ?? null,
        lastTemplateSent: lastTemplate?.createdAt ?? null,
        lastWebhookReceived: integrationStatus.whatsappCloud.lastWebhookReceivedAt ?? null,
        lastAIReply: lastAIReply?.createdAt ?? null
      },
      integrationStatus,
      recentImportedLeads: recentLeads.map(leadDto),
      recentReplies: recentReplies.map((message) => ({
        id: message.id,
        leadId: message.leadId,
        name: message.lead.name,
        phone: message.lead.phone,
        text: message.content,
        createdAt: message.createdAt
      })),
      recentOrders: await printwearOrderService.list(tenantId),
      recentHumanQueueItems: humanQueue.slice(0, 8),
      failedSends: recentErrors.map((log) => ({
        id: log.id,
        leadId: log.leadId,
        name: log.lead?.name ?? "System",
        phone: log.lead?.phone ?? "",
        action: log.action,
        error: log.errorMessage,
        createdAt: log.createdAt
      }))
    };
  },

  async leads(tenantId: string) {
    const leads = await prisma.lead.findMany({
      where: { companyId: tenantId },
      orderBy: { updatedAt: "desc" },
      include: {
        orderSummary: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    });

    return leads.map(leadDto);
  }
};
