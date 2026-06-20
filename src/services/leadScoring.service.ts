import { LeadTemperature, MessageDirection } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { chatEventsService } from "./chatEvents.service.js";

export const HOT_LEAD_KEYWORDS = [
  "price",
  "pricing",
  "quotation",
  "quote",
  "bulk order",
  "order",
  "buy",
  "purchase",
  "sample",
  "meeting",
  "call",
  "demo",
  "interested",
  "MOQ"
];

export const WARM_LEAD_KEYWORDS = [
  "details",
  "catalogue",
  "catalog",
  "colors",
  "sizes",
  "gsm",
  "hoodie",
  "tshirt",
  "polo",
  "oversized"
];

export type LeadScore = {
  messageCount: number;
  leadTemperature: LeadTemperature;
  temperatureReason: string;
};

function normalizeWords(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compact(value: string) {
  return normalizeWords(value).replace(/\s+/g, "");
}

function includesKeyword(conversationText: string, keyword: string) {
  const normalizedText = ` ${normalizeWords(conversationText)} `;
  const normalizedKeyword = normalizeWords(keyword);

  if (!normalizedKeyword) return false;

  const wordMatch = normalizedText.includes(` ${normalizedKeyword} `);
  const compactMatch = compact(conversationText).includes(compact(keyword));

  return wordMatch || compactMatch;
}

function findKeyword(conversationText: string, keywords: string[]) {
  return keywords.find((keyword) => includesKeyword(conversationText, keyword));
}

function getTemperatureByMessageCount(messageCount: number) {
  if (messageCount >= 6) {
    return {
      leadTemperature: LeadTemperature.HOT,
      countReason: "6 or more messages"
    };
  }

  if (messageCount >= 2) {
    return {
      leadTemperature: LeadTemperature.WARM,
      countReason: "2-5 messages"
    };
  }

  return {
    leadTemperature: LeadTemperature.SCRAP,
    countReason: "0-1 messages"
  };
}

function getAiInsight(conversationText: string) {
  const keyword = findKeyword(conversationText, [...HOT_LEAD_KEYWORDS, ...WARM_LEAD_KEYWORDS]);
  return keyword ? `AI Insight: Interested in ${keyword}` : null;
}

export function scoreLeadConversation(messages: Array<{ content: string }>): LeadScore {
  const messageCount = messages.length;
  const conversationText = messages.map((message) => message.content).join("\n");
  const score = getTemperatureByMessageCount(messageCount);
  const aiInsight = getAiInsight(conversationText);

  return {
    messageCount,
    leadTemperature: score.leadTemperature,
    temperatureReason: aiInsight ?? score.countReason
  };
}

export const leadScoringService = {
  async scoreLead(leadId: string) {
    const messages = await prisma.message.findMany({
      where: { leadId, direction: MessageDirection.INBOUND },
      select: { content: true },
      orderBy: { createdAt: "asc" }
    });

    return scoreLeadConversation(messages);
  },

  async refreshLeadTemperature(leadId: string) {
    const score = await this.scoreLead(leadId);

    const lead = await prisma.lead.update({
      where: { id: leadId },
      data: score
    });

    chatEventsService.publish({
      type: "lead.updated",
      leadId,
      payload: { lead }
    });

    return lead;
  },

  async refreshAllLeadTemperatures() {
    const leads = await prisma.lead.findMany({
      select: { id: true }
    });

    for (const lead of leads) {
      await this.refreshLeadTemperature(lead.id);
    }

    return { refreshed: leads.length };
  }
};
