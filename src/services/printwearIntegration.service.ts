import { IntegrationStatus, IntegrationType } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { companyIntegrationService } from "./companyIntegration.service.js";

function isConnected(status?: string | null) {
  return status === IntegrationStatus.CONNECTED;
}

function knowledgeIndexed(metadata: Record<string, unknown>) {
  return metadata.indexStatus === "INDEXED";
}

function jsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export const printwearIntegrationService = {
  async getGoogleSheetsConfig(tenantId: string) {
    return companyIntegrationService.googleSheets(tenantId);
  },

  async getWhatsAppConfig(tenantId: string) {
    return companyIntegrationService.whatsApp(tenantId);
  },

  async getTemplateConfig(tenantId: string) {
    await companyIntegrationService.assertConnected(tenantId, IntegrationType.WHATSAPP_TEMPLATE_SETTINGS);
    const whatsApp = await companyIntegrationService.whatsApp(tenantId, {});
    return {
      templateName: whatsApp.templateName,
      templateLanguage: whatsApp.templateLanguage || "en_US"
    };
  },

  async getAIConfig(tenantId: string) {
    const config = await companyIntegrationService.aiModel(tenantId);
    return {
      ...config,
      provider: config.provider || "ANTHROPIC",
      modelName: config.modelName || "claude-sonnet-4-6"
    };
  },

  async getKnowledgeBaseStatus(tenantId: string) {
    const [integration, chunks] = await Promise.all([
      prisma.integration.findUnique({
        where: { companyId_type: { companyId: tenantId, type: IntegrationType.KNOWLEDGE_BASE } },
        select: { status: true, metadata: true, lastVerifiedAt: true, lastVerificationError: true }
      }),
      prisma.knowledgeBase.count({ where: { companyId: tenantId } })
    ]);
    const metadata = jsonObject(integration?.metadata);

    return {
      status: knowledgeIndexed(metadata) || chunks > 0 ? "INDEXED" : "NOT_INDEXED",
      connected: integration?.status === IntegrationStatus.CONNECTED || chunks > 0,
      chunks,
      lastVerifiedAt: integration?.lastVerifiedAt ?? null,
      lastError: integration?.lastVerificationError ?? null
    };
  },

  async status(tenantId: string, webhookBaseUrl?: string) {
    const rows = await companyIntegrationService.listCompanyIntegrations(tenantId);
    const byType = Object.fromEntries(rows.map((row) => [row.type, row]));
    const knowledge = await this.getKnowledgeBaseStatus(tenantId);
    const whatsApp = byType.WHATSAPP_CLOUD;
    const whatsAppMetadata = jsonObject(whatsApp?.metadata);
    const phoneNumberId = whatsApp?.maskedDisplay?.WHATSAPP_PHONE_NUMBER_ID ?? null;
    const wabaId = whatsApp?.maskedDisplay?.WHATSAPP_BUSINESS_ACCOUNT_ID ?? null;

    return {
      googleSheets: {
        connected: isConnected(byType.GOOGLE_SHEETS?.status),
        status: byType.GOOGLE_SHEETS?.status ?? IntegrationStatus.NOT_CONNECTED,
        lastVerifiedAt: byType.GOOGLE_SHEETS?.lastVerifiedAt ?? null,
        error: byType.GOOGLE_SHEETS?.lastVerificationError ?? null
      },
      whatsappCloud: {
        connected: isConnected(whatsApp?.status),
        status: whatsApp?.status ?? IntegrationStatus.NOT_CONNECTED,
        phoneNumberId,
        wabaId,
        webhookUrl: webhookBaseUrl ? `${webhookBaseUrl}/api/webhooks/whatsapp` : whatsAppMetadata.webhookUrl ?? null,
        coexistenceStatus: whatsAppMetadata.coexistenceStatus ?? "Not Confirmed",
        lastWebhookReceivedAt: whatsAppMetadata.lastWebhookReceivedAt ?? null,
        lastInboundCustomerMessageAt: whatsAppMetadata.lastInboundCustomerMessageAt ?? null,
        lastOutboundCrmMessageAt: whatsAppMetadata.lastOutboundCrmMessageAt ?? null,
        lastMessageStatusUpdateAt: whatsAppMetadata.lastMessageStatusUpdateAt ?? null,
        error: whatsApp?.lastVerificationError ?? null
      },
      templateSettings: {
        connected: isConnected(byType.WHATSAPP_TEMPLATE_SETTINGS?.status),
        status: byType.WHATSAPP_TEMPLATE_SETTINGS?.status ?? IntegrationStatus.NOT_CONNECTED,
        templateName: byType.WHATSAPP_TEMPLATE_SETTINGS?.maskedDisplay?.WHATSAPP_TEMPLATE_NAME ?? null,
        templateLanguage: byType.WHATSAPP_TEMPLATE_SETTINGS?.maskedDisplay?.WHATSAPP_TEMPLATE_LANGUAGE ?? null,
        error: byType.WHATSAPP_TEMPLATE_SETTINGS?.lastVerificationError ?? null
      },
      aiModel: {
        connected: isConnected(byType.AI_MODEL?.status),
        status: byType.AI_MODEL?.status ?? IntegrationStatus.NOT_CONNECTED,
        provider: byType.AI_MODEL?.maskedDisplay?.AI_PROVIDER ?? "ANTHROPIC",
        modelName: byType.AI_MODEL?.maskedDisplay?.AI_MODEL_NAME ?? "claude-sonnet-4-6",
        error: byType.AI_MODEL?.lastVerificationError ?? null
      },
      knowledgeBase: knowledge
    };
  }
};
