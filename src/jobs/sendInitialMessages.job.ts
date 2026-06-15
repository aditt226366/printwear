import { prisma } from "../config/prisma.js";
import { googleSheetsService } from "../services/googleSheets.service.js";
import { chatEventsService } from "../services/chatEvents.service.js";
import { leadService } from "../services/lead.service.js";
import { messageService } from "../services/message.service.js";
import { validateWhatsAppConfig, whatsappService } from "../services/whatsapp.service.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const templateText =
  `Hello {{name}},

Thank you for connecting with Printwear👋.

We specialize in custom apparel solutions including:
* Round Neck T-Shirts
* Polo/Collar T-Shirts
* Oversized T-Shirts
* Hoodies
* Kids Wear

Please let us know your requirement and our team will be happy to assist you with suitable options.

Reply with:
1 - T-Shirts
2 - Hoodies
3 - Kids Wear
4 - Custom Bulk Order`;

export async function sendInitialMessagesJob(companyId?: string) {
  logger.info("Validating WhatsApp environment for welcome sends");
  validateWhatsAppConfig();
  logger.info("WhatsApp environment validated for welcome sends");

  const leads = await leadService.findNewLeadsForInitialMessages(100, companyId);
  logger.info({ pendingLeadCount: leads.length }, "Loaded pending welcome leads from database");
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  if (leads.length === 0) {
    logger.info("No leads pending welcome message");
  }

  for (const lead of leads) {
    try {
      const alreadySent = await messageService.hasInitialTemplateMessage(lead.id);
      if (alreadySent) {
        skipped += 1;
        await leadService.markInitialMessageSent(lead.id);
        continue;
      }

      await messageService.createSendLog({
        leadId: lead.id,
        action: "send_initial_template",
        status: "attempted"
      }).catch((logError) => {
        logger.error({ logError, leadId: lead.id }, "Failed to write attempted send log");
      });

      logger.info({ leadId: lead.id }, "Sending WhatsApp welcome template");
      const response = await whatsappService.sendTemplateMessage(lead.phone, lead.name);

      logger.info({ leadId: lead.id, messageId: response.messageId }, "Writing welcome message result to database");
      const result = await prisma.$transaction(async (tx) => {
        const message = await tx.message.create({
          data: {
            leadId: lead.id,
            whatsappMessageId: response.messageId,
            direction: "OUTBOUND",
            type: "TEMPLATE",
            content: templateText.replace("{{name}}", lead.name),
            status: "SENT",
            rawPayload: response.rawResponse as object
          }
        });

        const updatedLead = await tx.lead.update({
          where: { id: lead.id },
          data: { status: "MESSAGED" }
        });

        await tx.sendLog.create({
          data: {
            leadId: lead.id,
            action: "send_initial_template",
            status: "sent"
          }
        });

        return { message, lead: updatedLead };
      }).catch((error) => {
        logger.error({ error, leadId: lead.id, messageId: response.messageId }, "Database update failed after WhatsApp welcome send");
        throw new AppError(
          "Database update failed",
          500,
          "WhatsApp accepted the message, but the app could not save the message result. Check DATABASE_URL and database connectivity."
        );
      });
      logger.info({ leadId: lead.id, messageId: result.message.whatsappMessageId }, "Welcome database update complete");

      chatEventsService.publish({
        type: "message.created",
        leadId: lead.id,
        payload: { message: result.message }
      });
      chatEventsService.publish({
        type: "lead.updated",
        leadId: lead.id,
        payload: { lead: result.lead }
      });

      if (lead.googleSheetRowNumber) {
        await googleSheetsService.updateLeadStatus(lead.googleSheetRowNumber, "messaged");
      }

      await leadService.refreshLeadScore(lead.id);
      logger.info({ leadId: lead.id }, "Welcome send workflow completed");
      sent += 1;
    } catch (error) {
      failed += 1;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error({ error, leadId: lead.id }, "Initial template send failed");

      await messageService.createSendLog({
        leadId: lead.id,
        action: "send_initial_template",
        status: "failed",
        errorMessage
      }).catch((logError) => {
        logger.error({ logError, leadId: lead.id }, "Failed to write failed send log");
      });
      await leadService.markInitialMessageFailed(lead.id).catch((markError) => {
        logger.error({ markError, leadId: lead.id }, "Failed to mark lead as failed");
      });

      if (error instanceof AppError) {
        throw error;
      }
    }
  }

  return {
    success: true,
    processed: leads.length,
    sent,
    sentCount: sent,
    skipped,
    failed
  };
}
