import { HumanPriority } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { chatEventsService } from "./chatEvents.service.js";
import { humanActionService } from "./humanAction.service.js";
import { printwearSheetService } from "./printwearSheet.service.js";

function priorityScore(input: {
  leadTemperature?: string | null;
  hasOrderIntent?: boolean;
  asksForHuman?: boolean;
  aiLowConfidence?: boolean;
  waitingMinutes?: number;
  repeatedMessages?: boolean;
}) {
  let score = 0;
  if (input.leadTemperature === "HOT") score += 30;
  if (input.hasOrderIntent) score += 30;
  if (input.asksForHuman) score += 30;
  if (input.aiLowConfidence) score += 20;
  if ((input.waitingMinutes ?? 0) > 30) score += 10;
  if (input.repeatedMessages) score += 10;
  return score;
}

function priorityFromScore(score: number) {
  if (score >= 60) return HumanPriority.HIGH;
  if (score >= 30) return HumanPriority.MEDIUM;
  return HumanPriority.LOW;
}

export const printwearHumanQueueService = {
  priorityScore,

  evaluateNeed(message: string) {
    const humanAttention = humanActionService.detectHumanAttention(message);
    const asksForHuman = /\b(human|agent|person|call|talk to|representative)\b/i.test(message);
    const hasOrderIntent = /\b(order|buy|purchase|need|want|quote|price|pieces?|pcs?|hoodies?|t[\s-]?shirts?)\b/i.test(message);
    return {
      needsHuman: Boolean(humanAttention || asksForHuman),
      reason: humanAttention?.reason ?? (asksForHuman ? "Human takeover requested" : hasOrderIntent ? "Order details need review" : "AI confidence low"),
      hasOrderIntent,
      asksForHuman
    };
  },

  async addToQueue(tenantId: string, leadId: string, reason = "Manual human takeover", scoreInput: Parameters<typeof priorityScore>[0] = {}) {
    const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId: tenantId }, select: { id: true, leadTemperature: true } });
    if (!lead) return null;
    const score = priorityScore({ ...scoreInput, leadTemperature: lead.leadTemperature });
    const updated = await prisma.lead.update({
      where: { id: leadId },
      data: {
        humanTakeoverRequired: true,
        humanPriority: priorityFromScore(score),
        humanReason: reason,
        humanResolvedAt: null
      }
    });
    await printwearSheetService.updateHumanQueueStatus(tenantId, leadId, reason).catch(() => null);
    chatEventsService.publish({ type: "lead.updated", leadId, payload: { lead: updated } });
    return updated;
  },

  async resolveQueueItem(tenantId: string, leadId: string) {
    const lead = await humanActionService.resolve(leadId, tenantId);
    await printwearSheetService.updateHumanQueueStatus(tenantId, leadId, "Resolved").catch(() => null);
    return lead;
  },

  async list(tenantId: string) {
    return humanActionService.listQueue(tenantId);
  }
};
