import { prisma } from "../config/prisma.js";
import { googleSheetsService } from "../services/googleSheets.service.js";
import { chatEventsService } from "../services/chatEvents.service.js";
import { leadService } from "../services/lead.service.js";
import { messageService } from "../services/message.service.js";
import { whatsappService } from "../services/whatsapp.service.js";
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

export async function sendInitialMessagesJob() {
  const leads = await leadService.findNewLeadsForInitialMessages();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

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
      });

      const response = await whatsappService.sendTemplateMessage(lead.phone, lead.name);

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
      });

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
      });
      await leadService.markInitialMessageFailed(lead.id).catch((markError) => {
        logger.error({ markError, leadId: lead.id }, "Failed to mark lead as failed");
      });
    }
  }

  return {
    processed: leads.length,
    sent,
    skipped,
    failed
  };
}
