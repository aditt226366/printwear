import type { Request, Response } from "express";
import { claudeService } from "../services/claude.service.js";
import { automationService } from "../services/automation.service.js";
import { companyIntegrationService } from "../services/companyIntegration.service.js";
import { knowledgeService } from "../services/knowledge.service.js";
import { leadService } from "../services/lead.service.js";
import { resolveMenuIntent } from "../services/menuIntent.service.js";
import { messageService } from "../services/message.service.js";
import { webhookStatusService } from "../services/webhookStatus.service.js";
import { whatsappService } from "../services/whatsapp.service.js";
import { asyncHandler, AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export const verifyWebhook = asyncHandler(async (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && typeof token === "string" && typeof challenge === "string" && await companyIntegrationService.acceptsWebhookVerifyToken(token)) {
    res.status(200).send(challenge);
    return;
  }

  throw new AppError("Webhook verification failed", 403);
});

export const receiveWebhook = asyncHandler(async (req: Request, res: Response) => {
  const payload = req.body;
  const receivedAt = new Date();
  webhookStatusService.markWebhookReceived(receivedAt);
  logger.info({
    receivedAt: receivedAt.toISOString(),
    entryCount: Array.isArray((payload as { entry?: unknown[] })?.entry)
      ? (payload as { entry?: unknown[] }).entry?.length
      : 0
  }, "Webhook received");

  await processWebhookPayload(payload);

  res.status(200).json({ received: true });
});

export const getWebhookStatus = asyncHandler(async (req: Request, res: Response) => {
  const protocol = req.get("x-forwarded-proto") ?? req.protocol;
  const host = req.get("host") ?? "localhost";
  res.json(webhookStatusService.snapshot(`${protocol}://${host}/webhook`));
});

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

async function safeCreateSendLog(input: Parameters<typeof messageService.createSendLog>[0]) {
  try {
    await messageService.createSendLog(input);
  } catch (error) {
    logger.error({ error, action: input.action, status: input.status, leadId: input.leadId }, "Database error while saving send log");
  }
}

async function processStatusUpdates(payload: unknown) {
  const statusUpdates = whatsappService.parseStatusWebhook(payload);
  logger.info({ count: statusUpdates.length }, "Webhook status updates parsed");

  for (const statusUpdate of statusUpdates) {
    try {
      await messageService.updateMessageStatus(statusUpdate.messageId, statusUpdate.status, statusUpdate.rawPayload);
      logger.info(
        {
          whatsappMessageId: statusUpdate.messageId,
          recipientId: statusUpdate.recipientId,
          status: statusUpdate.status
        },
        "WhatsApp message status saved"
      );
    } catch (error) {
      logger.error(
        { error, whatsappMessageId: statusUpdate.messageId, status: statusUpdate.status },
        "Database error while saving WhatsApp status update"
      );
    }
  }
}

async function processInboundMessage(incoming: ReturnType<typeof whatsappService.parseIncomingWebhook>[number]) {
  logger.info(
    {
      whatsappMessageId: incoming.messageId,
      from: incoming.from,
      type: incoming.type,
      contentLength: incoming.content.length
    },
    "Inbound WhatsApp message parsed"
  );

  const companyId = await companyIntegrationService.findCompanyByWhatsAppPhoneNumberId(incoming.phoneNumberId);
  if (!companyId) {
    logger.error(
      { phoneNumberId: incoming.phoneNumberId, whatsappMessageId: incoming.messageId },
      "Unable to route inbound webhook to a company"
    );
    return;
  }

  let lead;
  try {
    lead = await leadService.findOrCreateFromInbound(incoming.from, incoming.profileName, companyId);
    logger.info(
      { leadId: lead.id, phone: lead.phone, whatsappMessageId: incoming.messageId },
      "Lead saved from inbound webhook"
    );
  } catch (error) {
    logger.error(
      { error, from: incoming.from, whatsappMessageId: incoming.messageId },
      "Database error while saving inbound lead"
    );
    return;
  }

  let inbound;
  try {
    inbound = await messageService.createInboundMessage({
      leadId: lead.id,
      whatsappMessageId: incoming.messageId,
      type: incoming.type,
      content: incoming.content,
      rawPayload: incoming.rawPayload
    });
    logger.info(
      {
        leadId: lead.id,
        messageId: inbound.message?.id,
        whatsappMessageId: incoming.messageId,
        duplicate: inbound.duplicate
      },
      "Inbound message saved to database"
    );
  } catch (error) {
    logger.error(
      { error, leadId: lead.id, whatsappMessageId: incoming.messageId },
      "Database error while saving inbound message"
    );
    return;
  }

  if (inbound.duplicate) {
    logger.info({ whatsappMessageId: incoming.messageId, leadId: lead.id }, "Duplicate inbound webhook ignored");
    return;
  }

  try {
    const workflowHandled = await automationService.executeMatchingWorkflows({
      leadId: lead.id,
      phone: lead.phone,
      text: incoming.content,
      source: lead.source
    });

    if (workflowHandled) {
      webhookStatusService.markMessageProcessed(incoming.messageId);
      await safeCreateSendLog({
        leadId: lead.id,
        action: "workflow_reply",
        status: "sent"
      });
      logger.info({ leadId: lead.id, inboundMessageId: incoming.messageId }, "Inbound message handled by active AI workflow");
      return;
    }
  } catch (error) {
    logger.error({ error, leadId: lead.id, whatsappMessageId: incoming.messageId }, "AI workflow execution failed before Claude fallback");
    await safeCreateSendLog({
      leadId: lead.id,
      action: "workflow_reply",
      status: "failed",
      errorMessage: errorMessage(error)
    });
  }

  try {
    const scoredLead = await leadService.markRepliedAndRefreshScore(lead.id);
    logger.info(
      {
        leadId: lead.id,
        leadTemperature: scoredLead.leadTemperature,
        temperatureReason: scoredLead.temperatureReason
      },
      "Lead status calculated after inbound message"
    );
  } catch (error) {
    logger.error({ error, leadId: lead.id }, "Database error while calculating lead status");
  }

  const menuIntent = resolveMenuIntent(incoming.content);
  const knowledgeQuery = menuIntent?.searchQuery ?? incoming.content;
  const customerMessage = menuIntent?.assistantMessage ?? incoming.content;
  let knowledgeContext = "";
  let conversationHistory = "";

  try {
    knowledgeContext = await knowledgeService.search(knowledgeQuery, 3, lead.companyId);
    conversationHistory = await messageService.getRecentConversation(lead.id, 8);
  } catch (error) {
    logger.error({ error, leadId: lead.id, whatsappMessageId: incoming.messageId }, "Database error while preparing Claude context");
    webhookStatusService.markWhatsAppFailed({
      leadId: lead.id,
      recipient: lead.phone,
      errorMessage: `Claude context failed: ${errorMessage(error)}`
    });
    await safeCreateSendLog({
      leadId: lead.id,
      action: "claude_reply",
      status: "failed",
      errorMessage: errorMessage(error)
    });
    return;
  }

  let reply: string;
  try {
    logger.info(
      {
        leadId: lead.id,
        whatsappMessageId: incoming.messageId,
        hasMenuIntent: Boolean(menuIntent),
        knowledgeQueryLength: knowledgeQuery.length,
        conversationHistoryLength: conversationHistory.length
      },
      "Claude called for inbound WhatsApp reply"
    );
    reply = await claudeService.generateReply(customerMessage, knowledgeContext, conversationHistory, lead.companyId);
  } catch (error) {
    logger.error({ error, leadId: lead.id, whatsappMessageId: incoming.messageId }, "Claude error while generating reply");
    webhookStatusService.markWhatsAppFailed({
      leadId: lead.id,
      recipient: lead.phone,
      errorMessage: `Claude reply failed: ${errorMessage(error)}`
    });
    await safeCreateSendLog({
      leadId: lead.id,
      action: "claude_reply",
      status: "failed",
      errorMessage: errorMessage(error)
    });
    return;
  }

  try {
    const sent = await whatsappService.sendTextMessage(lead.phone, reply, lead.companyId);
    logger.info(
      {
        leadId: lead.id,
        recipient: lead.phone,
        whatsappMessageId: sent.messageId
      },
      "WhatsApp reply sent"
    );

    await messageService.createOutboundMessage({
      leadId: lead.id,
      whatsappMessageId: sent.messageId,
      type: "TEXT",
      content: reply,
      status: "SENT",
      rawPayload: sent.rawResponse
    });
    webhookStatusService.markWhatsAppSent({
      messageId: sent.messageId,
      leadId: lead.id,
      recipient: lead.phone
    });
    webhookStatusService.markMessageProcessed(incoming.messageId);
    logger.info(
      { leadId: lead.id, inboundMessageId: incoming.messageId, outboundMessageId: sent.messageId },
      "Claude reply saved as outbound message"
    );
  } catch (error) {
    logger.error({ error, leadId: lead.id, recipient: lead.phone }, "Meta WhatsApp send or database save error");
    webhookStatusService.markWhatsAppFailed({
      leadId: lead.id,
      recipient: lead.phone,
      errorMessage: errorMessage(error)
    });
    await safeCreateSendLog({
      leadId: lead.id,
      action: "claude_reply",
      status: "failed",
      errorMessage: errorMessage(error)
    });
    return;
  }

  try {
    const refreshedLead = await leadService.refreshLeadScore(lead.id);
    logger.info(
      {
        leadId: lead.id,
        leadTemperature: refreshedLead.leadTemperature,
        temperatureReason: refreshedLead.temperatureReason
      },
      "Lead status calculated after Claude reply"
    );
  } catch (error) {
    logger.error({ error, leadId: lead.id }, "Database error while refreshing lead status after reply");
  }

  await safeCreateSendLog({
    leadId: lead.id,
    action: "claude_reply",
    status: "sent"
  });
}

async function processWebhookPayload(payload: unknown) {
  await processStatusUpdates(payload);

  const incomingMessages = whatsappService.parseIncomingWebhook(payload);
  logger.info({ count: incomingMessages.length }, "Inbound webhook messages parsed");

  for (const incoming of incomingMessages) {
    await processInboundMessage(incoming);
  }
}
