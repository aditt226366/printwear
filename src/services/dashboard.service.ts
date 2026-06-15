import { HumanPriority, LeadStatus, LeadTemperature, MessageDirection, MessageStatus, MessageType, OrderStatus } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { leadService } from "./lead.service.js";
import { knowledgeIngestionService } from "./knowledgeIngestion.service.js";
import { messageService } from "./message.service.js";
import { whatsappService } from "./whatsapp.service.js";

export type LeadTemperatureFilter = "HOT" | "WARM" | "SCRAP";

export type LeadListFilters = {
  search?: string;
  temperature?: LeadTemperatureFilter;
};

function toTitle(value: string) {
  return value.toLowerCase().replace(/(^|_)([a-z])/g, (_match, prefix: string, char: string) => `${prefix ? " " : ""}${char.toUpperCase()}`);
}

function temperatureFromMessageCount(messageCount: number) {
  if (messageCount >= 6) return LeadTemperature.HOT;
  if (messageCount >= 2) return LeadTemperature.WARM;
  return LeadTemperature.SCRAP;
}

function temperatureReasonFromMessageCount(messageCount: number) {
  if (messageCount >= 6) return "6 or more messages";
  if (messageCount >= 2) return "2-5 messages";
  return "0-1 messages";
}

function whereForTemperature(temperature?: LeadTemperatureFilter) {
  if (temperature === "HOT") return { messageCount: { gte: 6 } };
  if (temperature === "WARM") return { messageCount: { gte: 2, lte: 5 } };
  if (temperature === "SCRAP") return { messageCount: { lt: 2 } };
  return {};
}

function aiInsightFromReason(reason: string) {
  return reason.startsWith("AI Insight:") ? reason : null;
}

function unreadInboundCount(messages: Array<{ direction: MessageDirection }>) {
  let count = 0;

  for (const message of messages) {
    if (message.direction !== MessageDirection.INBOUND) {
      break;
    }
    count += 1;
  }

  return count;
}

function messageSender(direction: MessageDirection) {
  return direction === MessageDirection.INBOUND ? "Customer" : "Business";
}

export const dashboardService = {
  async overview(companyId?: string) {
    const leadWhere = companyId ? { companyId } : {};
    const messageWhere = companyId ? { lead: { companyId } } : {};
    const [
      totalLeads,
      hotLeads,
      warmLeads,
      scrapLeads,
      activeChats,
      inboundMessages,
      outboundMessages,
      recentLeads,
      recentLogs
    ] = await Promise.all([
      prisma.lead.count({ where: leadWhere }),
      prisma.lead.count({ where: { ...leadWhere, ...whereForTemperature("HOT") } }),
      prisma.lead.count({ where: { ...leadWhere, ...whereForTemperature("WARM") } }),
      prisma.lead.count({ where: { ...leadWhere, ...whereForTemperature("SCRAP") } }),
      prisma.lead.count({ where: { ...leadWhere, messageCount: { gt: 0 } } }),
      prisma.message.count({ where: { ...messageWhere, direction: MessageDirection.INBOUND } }),
      prisma.message.count({ where: { ...messageWhere, direction: MessageDirection.OUTBOUND } }),
      prisma.lead.findMany({
        where: leadWhere,
        orderBy: { updatedAt: "desc" },
        take: 6,
        include: {
          orderSummary: true,
          messages: {
            orderBy: { createdAt: "desc" },
            take: 20
          }
        }
      }),
      prisma.sendLog.findMany({
        where: companyId ? { lead: { companyId } } : {},
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { lead: true }
      })
    ]);

    return {
      stats: {
        totalLeads,
        hotLeads,
        warmLeads,
        scrapLeads,
        activeChats,
        inboundMessages,
        outboundMessages
      },
      recentLeads: recentLeads.map((lead) => ({
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        status: lead.status,
        temperature: temperatureFromMessageCount(lead.messageCount),
        temperatureReason: lead.temperatureReason,
        temperatureBasis: temperatureReasonFromMessageCount(lead.messageCount),
        aiInsight: aiInsightFromReason(lead.temperatureReason),
        humanTakeoverRequired: lead.humanTakeoverRequired,
        humanPriority: lead.humanPriority,
        humanReason: lead.humanReason,
        humanResolvedAt: lead.humanResolvedAt,
        orderSummary: lead.orderSummary,
        messageCount: lead.messageCount,
        updatedAt: lead.messages[0]?.createdAt ?? lead.updatedAt,
        lastMessage: lead.messages[0]?.content ?? "No conversation yet",
        lastMessageAt: lead.messages[0]?.createdAt ?? lead.updatedAt,
        unreadCount: unreadInboundCount(lead.messages)
      })),
      recentLogs: recentLogs.map((log) => ({
        id: log.id,
        leadName: log.lead?.name ?? "System",
        action: toTitle(log.action),
        status: toTitle(log.status),
        errorMessage: log.errorMessage,
        createdAt: log.createdAt
      }))
    };
  },

  async listLeads(filters: LeadListFilters = {}, companyId?: string) {
    const search = filters.search?.trim();
    const where = {
      ...(companyId ? { companyId } : {}),
      ...whereForTemperature(filters.temperature),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search, mode: "insensitive" as const } },
              { source: { contains: search, mode: "insensitive" as const } },
              { temperatureReason: { contains: search, mode: "insensitive" as const } },
              { messages: { some: { content: { contains: search, mode: "insensitive" as const } } } },
              ...(Object.values(LeadTemperature).some((value) => value.toLowerCase() === search.toLowerCase())
                ? [whereForTemperature(search.toUpperCase() as LeadTemperatureFilter)]
                : []),
              ...(Object.values(LeadStatus).some((value) => value.toLowerCase() === search.toLowerCase())
                ? [{ status: LeadStatus[search.toUpperCase() as keyof typeof LeadStatus] }]
                : [])
            ]
          }
        : {})
    };

    const leads = await prisma.lead.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      include: {
        orderSummary: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 20
        }
      }
    });

    return leads.map((lead) => ({
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      status: lead.status,
      source: lead.source,
      messageCount: lead.messageCount,
      temperature: temperatureFromMessageCount(lead.messageCount),
      temperatureReason: lead.temperatureReason,
      temperatureBasis: temperatureReasonFromMessageCount(lead.messageCount),
      aiInsight: aiInsightFromReason(lead.temperatureReason),
      humanTakeoverRequired: lead.humanTakeoverRequired,
      humanPriority: lead.humanPriority,
      humanReason: lead.humanReason,
      humanResolvedAt: lead.humanResolvedAt,
      orderSummary: lead.orderSummary,
      updatedAt: lead.messages[0]?.createdAt ?? lead.updatedAt,
      lastMessage: lead.messages[0]?.content ?? "No messages yet",
      lastMessageAt: lead.messages[0]?.createdAt ?? lead.updatedAt,
      unreadCount: unreadInboundCount(lead.messages)
    }));
  },

  async conversation(leadId: string, companyId?: string) {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        orderSummary: true,
        messages: {
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!lead || (companyId && lead.companyId !== companyId)) {
      return null;
    }

    return {
      lead: {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        status: lead.status,
        temperature: temperatureFromMessageCount(lead.messageCount),
        messageCount: lead.messageCount,
        temperatureReason: lead.temperatureReason,
        temperatureBasis: temperatureReasonFromMessageCount(lead.messageCount),
        aiInsight: aiInsightFromReason(lead.temperatureReason),
        humanTakeoverRequired: lead.humanTakeoverRequired,
        humanPriority: lead.humanPriority,
        humanReason: lead.humanReason,
        humanResolvedAt: lead.humanResolvedAt,
        orderSummary: lead.orderSummary
      },
      messages: lead.messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        sender: messageSender(message.direction),
        type: message.type,
        text: message.content,
        content: message.content,
        status: message.status,
        timestamp: message.createdAt,
        createdAt: message.createdAt
      }))
    };
  },

  async sendManualMessage(leadId: string, text: string, companyId?: string) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead || (companyId && lead.companyId !== companyId)) {
      throw new Error("Lead not found");
    }

    const sent = await whatsappService.sendTextMessage(lead.phone, text);
    const message = await messageService.createOutboundMessage({
      leadId,
      whatsappMessageId: sent.messageId,
      type: "TEXT",
      content: text,
      status: "SENT",
      rawPayload: sent.rawResponse
    });
    await messageService.createSendLog({
      leadId,
      action: "manual_message",
      status: "sent"
    });
    await leadService.refreshLeadScore(leadId);

    return message;
  },

  async listKnowledge(companyId?: string) {
    return prisma.knowledgeBase.findMany({
      where: companyId ? { companyId } : {},
      orderBy: [{ category: "asc" }, { title: "asc" }]
    });
  },

  async createKnowledge(input: { title: string; category: string; content: string }, companyId: string) {
    return prisma.knowledgeBase.create({
      data: {
        companyId,
        ...input,
        sourceType: "MANUAL",
        sourceName: "Dashboard manual entry"
      }
    });
  },

  async updateKnowledge(id: string, input: { title: string; category: string; content: string }, companyId?: string) {
    return prisma.knowledgeBase.update({
      where: { id, ...(companyId ? { companyId } : {}) },
      data: input
    });
  },

  async deleteKnowledge(id: string, companyId?: string) {
    return prisma.knowledgeBase.delete({
      where: { id, ...(companyId ? { companyId } : {}) }
    });
  },

  async ingestWebsite(url: string, companyId: string) {
    const result = await knowledgeIngestionService.ingestWebsite(url, {
      titlePrefix: "Website",
      category: "website",
      companyId
    });

    await messageService.createSendLog({
      action: "knowledge_website_sync",
      status: "sent",
      errorMessage: `Synced ${result.chunksCreated} chunks from ${result.pagesStored} pages`
    });

    return result;
  },

  async syncPrintwearWebsite(companyId: string) {
    try {
      const result = await knowledgeIngestionService.ingestWebsite(env.PRINTWEAR_WEBSITE_URL, {
        titlePrefix: "Printwear Website",
        category: "printwear_website",
        companyId
      });

      await messageService.createSendLog({
        action: "printwear_website_sync",
        status: "sent",
        errorMessage: `Synced ${result.chunksCreated} chunks from ${result.pagesStored} pages`
      });

      return result;
    } catch (error) {
      await messageService.createSendLog({
        action: "printwear_website_sync",
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown website sync error"
      });
      throw error;
    }
  },

  async ingestUploadedKnowledge(input: {
    originalName: string;
    mimeType: string;
    buffer: Buffer;
    title?: string;
    category?: string;
    companyId: string;
  }) {
    const result = await knowledgeIngestionService.ingestUpload(
      {
        originalName: input.originalName,
        mimeType: input.mimeType,
        buffer: input.buffer
      },
      {
        title: input.title,
        category: input.category,
        companyId: input.companyId
      }
    );

    await messageService.createSendLog({
      action: "knowledge_file_upload",
      status: "sent",
      errorMessage: `Imported ${result.created} chunks from ${input.originalName}`
    });

    return result;
  },

  async listLogs(companyId?: string) {
    return prisma.sendLog.findMany({
      where: companyId ? { lead: { companyId } } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { lead: true }
    });
  },

  enums() {
    return {
      leadStatuses: Object.values(LeadStatus),
      leadTemperatures: Object.values(LeadTemperature),
      messageTypes: Object.values(MessageType),
      messageStatuses: Object.values(MessageStatus),
      humanPriorities: Object.values(HumanPriority),
      orderStatuses: Object.values(OrderStatus)
    };
  }
};
