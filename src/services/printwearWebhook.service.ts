import { IntegrationStatus, IntegrationType, MessageStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { chatEventsService } from "./chatEvents.service.js";
import { messageService } from "./message.service.js";
import { printwearAIAgentService } from "./printwearAIAgent.service.js";
import { printwearLeadScoringService } from "./printwearLeadScoring.service.js";
import { printwearSheetService } from "./printwearSheet.service.js";
import { printwearTenantService } from "./printwearTenant.service.js";

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function mergeWhatsAppMetadata(tenantId: string, metadata: Record<string, unknown>) {
  const existing = await prisma.integration.findUnique({
    where: { companyId_type: { companyId: tenantId, type: IntegrationType.WHATSAPP_CLOUD } },
    select: { metadata: true }
  });

  await prisma.integration.upsert({
    where: { companyId_type: { companyId: tenantId, type: IntegrationType.WHATSAPP_CLOUD } },
    create: {
      companyId: tenantId,
      type: IntegrationType.WHATSAPP_CLOUD,
      status: IntegrationStatus.PARTIALLY_CONNECTED,
      metadata: metadata as Prisma.InputJsonValue
    },
    update: {
      metadata: { ...object(existing?.metadata), ...metadata } as Prisma.InputJsonValue
    }
  });
}

export const printwearWebhookService = {
  async dedupeWebhookEvent(whatsappMessageId?: string | null) {
    if (!whatsappMessageId) return false;
    return Boolean(await prisma.message.findUnique({ where: { whatsappMessageId } }));
  },

  async processIncomingMessage(input: {
    tenantId: string;
    leadId: string;
    content: string;
    whatsappMessageId?: string;
  }) {
    const isPrintwear = await printwearTenantService.isPrintwearTenant(input.tenantId);
    if (!isPrintwear) return { action: "not_printwear" };

    const lead = await printwearLeadScoringService.recalculateLeadTemperature(input.leadId);
    await mergeWhatsAppMetadata(input.tenantId, {
      coexistenceStatus: "Enabled",
      lastWebhookReceivedAt: new Date().toISOString(),
      lastInboundCustomerMessageAt: new Date().toISOString()
    }).catch(() => null);
    await printwearSheetService.updateLeadRow(input.tenantId, input.leadId, {
      customerReplyCount: lead.messageCount,
      leadTemperature: lead.leadTemperature,
      lastCustomerMessage: input.content
    }).catch(() => null);

    return printwearAIAgentService.handleInboundMessage({
      tenantId: input.tenantId,
      leadId: input.leadId,
      customerMessage: input.content,
      whatsappMessageId: input.whatsappMessageId
    });
  },

  async processStatusUpdate(input: { messageId: string; status: string; rawPayload?: unknown }) {
    const message = await messageService.updateMessageStatus(input.messageId, input.status as keyof typeof MessageStatus, input.rawPayload);
    if (!message) return null;
    const lead = await prisma.lead.findUnique({ where: { id: message.leadId }, select: { id: true, companyId: true } });
    if (!lead || !await printwearTenantService.isPrintwearTenant(lead.companyId)) return message;

    await mergeWhatsAppMetadata(lead.companyId, {
      lastWebhookReceivedAt: new Date().toISOString(),
      lastMessageStatusUpdateAt: new Date().toISOString()
    }).catch(() => null);
    await printwearSheetService.updateMessageStatus(lead.companyId, lead.id, input.status).catch(() => null);
    return message;
  },

  emitRealtime(type: "message.created" | "message.status" | "lead.updated" | "order.updated", leadId: string, payload: unknown) {
    chatEventsService.publish({ type, leadId, payload });
  }
};
