import { MessageDirection, MessageStatus, MessageType } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/errors.js";
import { chatEventsService } from "./chatEvents.service.js";
import { messageService } from "./message.service.js";
import { printwearIntegrationService } from "./printwearIntegration.service.js";
import { printwearSheetService } from "./printwearSheet.service.js";
import { whatsappService } from "./whatsapp.service.js";

async function eligibleLeads(tenantId: string) {
  const leads = await prisma.lead.findMany({
    where: {
      companyId: tenantId,
      source: { in: ["GOOGLE_SHEET", "google_sheets", "google_sheet"] }
    },
    orderBy: { createdAt: "asc" },
    include: {
      messages: {
        where: { direction: MessageDirection.OUTBOUND, type: MessageType.TEMPLATE },
        take: 1
      }
    }
  });

  return leads.filter((lead) => lead.messages.length === 0);
}

export const printwearTemplateSendService = {
  async importAndSendApprovedTemplate(tenantId: string, options: { confirm?: boolean } = {}) {
    const sync = await printwearSheetService.syncLeads(tenantId);
    const [whatsApp, template] = await Promise.all([
      printwearIntegrationService.getWhatsAppConfig(tenantId),
      printwearIntegrationService.getTemplateConfig(tenantId)
    ]);

    if (!template.templateName) throw new AppError("WhatsApp template settings are not configured for this company.", 400);

    const leads = await eligibleLeads(tenantId);
    const preview = {
      validOptedInLeads: leads.length,
      invalidRows: sync.invalidRows,
      duplicates: sync.duplicates,
      templateName: template.templateName,
      templateLanguage: template.templateLanguage || "en_US",
      estimatedMessages: leads.length
    };

    if (!options.confirm) {
      return {
        requiresConfirmation: true,
        sync,
        preview,
        sent: 0,
        failed: 0,
        skipped: 0
      };
    }

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    const failures: Array<{ leadId: string; phone: string; error: string }> = [];

    for (const lead of leads) {
      try {
        const alreadySent = await messageService.hasInitialTemplateMessage(lead.id);
        if (alreadySent) {
          skipped += 1;
          continue;
        }

        await printwearSheetService.updateLeadRow(tenantId, lead.id, {
          templateStatus: "QUEUED",
          error: ""
        });

        const response = await whatsappService.sendNamedTemplateMessage({
          phone: lead.phone,
          templateName: template.templateName,
          templateLanguage: template.templateLanguage,
          companyId: tenantId,
          parameters: [{ type: "text", text: lead.name }]
        });

        const message = await prisma.message.create({
          data: {
            leadId: lead.id,
            whatsappMessageId: response.messageId,
            direction: MessageDirection.OUTBOUND,
            type: MessageType.TEMPLATE,
            content: `${template.templateName} (${template.templateLanguage}) sent to ${lead.name}`,
            status: MessageStatus.SENT,
            rawPayload: response.rawResponse as object
          }
        });
        const updatedLead = await prisma.lead.update({
          where: { id: lead.id },
          data: { status: "MESSAGED" }
        });
        await prisma.sendLog.create({
          data: {
            leadId: lead.id,
            action: "printwear_template_send",
            status: "sent"
          }
        });

        await printwearSheetService.updateLeadRow(tenantId, lead.id, {
          templateStatus: "SENT",
          templateSentAt: new Date().toISOString(),
          messageStatus: "SENT",
          error: ""
        });

        chatEventsService.publish({ type: "message.created", leadId: lead.id, payload: { message } });
        chatEventsService.publish({ type: "lead.updated", leadId: lead.id, payload: { lead: updatedLead } });
        sent += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : "Template send failed";
        failures.push({ leadId: lead.id, phone: lead.phone, error: message });
        await prisma.sendLog.create({
          data: {
            leadId: lead.id,
            action: "printwear_template_send",
            status: "failed",
            errorMessage: message
          }
        }).catch(() => null);
        await prisma.lead.update({ where: { id: lead.id }, data: { status: "FAILED" } }).catch(() => null);
        await printwearSheetService.updateLeadRow(tenantId, lead.id, {
          templateStatus: "FAILED",
          messageStatus: "FAILED",
          error: message
        }).catch(() => null);
      }
    }

    return {
      requiresConfirmation: false,
      sync,
      preview,
      sent,
      failed,
      skipped,
      failures,
      wabaId: whatsApp.businessAccountId ? "configured" : "missing"
    };
  },

  async queueTemplateMessages(tenantId: string) {
    return this.importAndSendApprovedTemplate(tenantId, { confirm: true });
  },

  async sendTemplateMessage(tenantId: string, leadId: string) {
    const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId: tenantId } });
    if (!lead) throw new AppError("Lead not found", 404);
    const template = await printwearIntegrationService.getTemplateConfig(tenantId);
    return whatsappService.sendNamedTemplateMessage({
      phone: lead.phone,
      templateName: template.templateName || "",
      templateLanguage: template.templateLanguage,
      companyId: tenantId,
      parameters: [{ type: "text", text: lead.name }]
    });
  },

  async handleTemplateFailure(tenantId: string, leadId: string, reason: string) {
    await printwearSheetService.updateLeadRow(tenantId, leadId, {
      templateStatus: "FAILED",
      messageStatus: "FAILED",
      error: reason
    });
  }
};
