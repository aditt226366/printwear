import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { claudeService } from "../services/claude.service.js";
import { knowledgeService } from "../services/knowledge.service.js";
import { leadService } from "../services/lead.service.js";
import { resolveMenuIntent } from "../services/menuIntent.service.js";
import { messageService } from "../services/message.service.js";
import { whatsappService } from "../services/whatsapp.service.js";
import { asyncHandler, AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export const verifyWebhook = asyncHandler(async (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (!env.WHATSAPP_VERIFY_TOKEN) {
    throw new AppError("WHATSAPP_VERIFY_TOKEN is not configured", 500);
  }

  if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN && typeof challenge === "string") {
    res.status(200).send(challenge);
    return;
  }

  throw new AppError("Webhook verification failed", 403);
});

export const receiveWebhook = asyncHandler(async (req: Request, res: Response) => {
  const payload = req.body;
  res.status(200).json({ received: true });

  setImmediate(() => {
    processWebhookPayload(payload).catch((error) => {
      logger.error({ error }, "Webhook processing failed");
    });
  });
});

async function processWebhookPayload(payload: unknown) {
  const statusUpdates = whatsappService.parseStatusWebhook(payload);

  for (const statusUpdate of statusUpdates) {
    await messageService.updateMessageStatus(statusUpdate.messageId, statusUpdate.status, statusUpdate.rawPayload);
  }

  const incomingMessages = whatsappService.parseIncomingWebhook(payload);

  for (const incoming of incomingMessages) {
    const lead = await leadService.findOrCreateFromInbound(incoming.from, incoming.profileName);
    const inbound = await messageService.createInboundMessage({
      leadId: lead.id,
      whatsappMessageId: incoming.messageId,
      type: incoming.type,
      content: incoming.content,
      rawPayload: incoming.rawPayload
    });

    if (inbound.duplicate) {
      logger.info({ whatsappMessageId: incoming.messageId }, "Duplicate inbound webhook ignored");
      continue;
    }

    try {
      await leadService.markRepliedAndRefreshScore(lead.id);
    } catch (error) {
      logger.error({ error, leadId: lead.id }, "Failed to mark inbound lead as replied");
    }

    try {
      const menuIntent = resolveMenuIntent(incoming.content);
      const knowledgeQuery = menuIntent?.searchQuery ?? incoming.content;
      const customerMessage = menuIntent?.assistantMessage ?? incoming.content;
      const knowledgeContext = await knowledgeService.search(knowledgeQuery, 3);
      const conversationHistory = await messageService.getRecentConversation(lead.id, 8);
      const reply = await claudeService.generateReply(customerMessage, knowledgeContext, conversationHistory);
      const sent = await whatsappService.sendTextMessage(lead.phone, reply);

      await messageService.createOutboundMessage({
        leadId: lead.id,
        whatsappMessageId: sent.messageId,
        type: "TEXT",
        content: reply,
        status: "SENT",
        rawPayload: sent.rawResponse
      });
      await leadService.refreshLeadScore(lead.id);
    } catch (error) {
      logger.error({ error, leadId: lead.id }, "Failed to generate or send Claude reply");
      await messageService.createSendLog({
        leadId: lead.id,
        action: "claude_reply",
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
}
