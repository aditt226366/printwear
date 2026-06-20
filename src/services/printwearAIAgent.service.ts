import { MessageStatus } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { claudeService } from "./claude.service.js";
import { knowledgeService } from "./knowledge.service.js";
import { messageService } from "./message.service.js";
import { printwearHumanQueueService } from "./printwearHumanQueue.service.js";
import { printwearIntegrationService } from "./printwearIntegration.service.js";
import { printwearOrderService } from "./printwearOrder.service.js";
import { printwearSheetService } from "./printwearSheet.service.js";
import { whatsappService } from "./whatsapp.service.js";

function isOptOut(text: string) {
  return /\b(STOP|UNSUBSCRIBE|CANCEL)\b/i.test(text.trim());
}

export const printwearAIAgentService = {
  async retrieveKnowledge(tenantId: string, query: string) {
    return knowledgeService.search(query, 4, tenantId);
  },

  async detectOrderIntent(tenantId: string, leadId: string) {
    return printwearOrderService.detectOrCreateOrder(tenantId, leadId);
  },

  async detectHumanQueueNeed(tenantId: string, leadId: string, message: string, lowConfidence = false) {
    const evaluation = printwearHumanQueueService.evaluateNeed(message);
    if (!evaluation.needsHuman && !lowConfidence) return null;
    return printwearHumanQueueService.addToQueue(tenantId, leadId, evaluation.reason, {
      hasOrderIntent: evaluation.hasOrderIntent,
      asksForHuman: evaluation.asksForHuman,
      aiLowConfidence: lowConfidence
    });
  },

  async generateReply(tenantId: string, leadId: string, customerMessage: string) {
    const knowledgeContext = await this.retrieveKnowledge(tenantId, customerMessage);
    const conversationHistory = await messageService.getRecentConversation(leadId, 8);
    if (!knowledgeContext.trim()) {
      await printwearHumanQueueService.addToQueue(tenantId, leadId, "KNOWLEDGE_BASE_MISSING", { aiLowConfidence: true });
      return null;
    }

    return claudeService.generateReply(customerMessage, knowledgeContext, conversationHistory, tenantId);
  },

  async sendAIReplyIfAllowed(tenantId: string, leadId: string, reply: string) {
    const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId: tenantId } });
    if (!lead || lead.humanTakeoverRequired) return null;

    const sent = await whatsappService.sendTextMessage(lead.phone, reply, tenantId);
    const message = await messageService.createOutboundMessage({
      leadId,
      whatsappMessageId: sent.messageId,
      type: "TEXT",
      content: reply,
      status: "SENT",
      rawPayload: sent.rawResponse
    });

    await printwearSheetService.updateLeadRow(tenantId, leadId, {
      lastAIReply: reply,
      messageStatus: MessageStatus.SENT
    }).catch(() => null);

    return message;
  },

  async handleInboundMessage(input: {
    tenantId: string;
    leadId: string;
    customerMessage: string;
    whatsappMessageId?: string;
  }) {
    const lead = await prisma.lead.findFirst({
      where: { id: input.leadId, companyId: input.tenantId },
      include: { orderSummary: true }
    });
    if (!lead) return { action: "ignored", reason: "Lead not found" };

    await printwearSheetService.updateLeadRow(input.tenantId, input.leadId, {
      lastCustomerMessage: input.customerMessage,
      customerReplyCount: lead.messageCount,
      leadTemperature: lead.leadTemperature
    }).catch(() => null);

    if (isOptOut(input.customerMessage)) {
      await prisma.sendLog.create({
        data: {
          leadId: input.leadId,
          action: "printwear_opt_out",
          status: "blocked",
          errorMessage: "Customer opted out"
        }
      }).catch(() => null);
      return { action: "blocked", reason: "Customer opted out" };
    }

    await this.detectOrderIntent(input.tenantId, input.leadId);
    const knowledgeStatus = await printwearIntegrationService.getKnowledgeBaseStatus(input.tenantId);
    if (!knowledgeStatus.connected) {
      await printwearHumanQueueService.addToQueue(input.tenantId, input.leadId, "KNOWLEDGE_BASE_MISSING", { aiLowConfidence: true });
      return { action: "human_queue", reason: "Knowledge base missing" };
    }

    if (lead.humanTakeoverRequired && !lead.humanResolvedAt) {
      return { action: "human_takeover_active" };
    }

    await printwearIntegrationService.getAIConfig(input.tenantId);
    const reply = await this.generateReply(input.tenantId, input.leadId, input.customerMessage);
    if (!reply) return { action: "human_queue", reason: "No knowledge-backed reply" };

    await this.detectHumanQueueNeed(input.tenantId, input.leadId, input.customerMessage, false);
    const refreshedLead = await prisma.lead.findUnique({ where: { id: input.leadId } });
    if (refreshedLead?.humanTakeoverRequired && !refreshedLead.humanResolvedAt) {
      return { action: "human_queue", reason: refreshedLead.humanReason ?? "Human takeover requested" };
    }

    const message = await this.sendAIReplyIfAllowed(input.tenantId, input.leadId, reply);
    await prisma.sendLog.create({
      data: {
        leadId: input.leadId,
        action: "printwear_ai_reply",
        status: message ? "sent" : "skipped"
      }
    }).catch(() => null);

    return { action: message ? "ai_reply_sent" : "skipped", message };
  },

  async test(tenantId: string, prompt = "Reply with OK.") {
    await printwearIntegrationService.getAIConfig(tenantId);
    const knowledge = await this.retrieveKnowledge(tenantId, prompt);
    const reply = await claudeService.generateReply(prompt, knowledge || "Printwear knowledge base test.", "", tenantId);
    return { reply };
  }
};
