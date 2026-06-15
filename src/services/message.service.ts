import {
  AutomationSendStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  Prisma
} from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { logger } from "../utils/logger.js";
import { chatEventsService } from "./chatEvents.service.js";
import { humanActionService } from "./humanAction.service.js";
import { leadScoringService } from "./leadScoring.service.js";
import { orderSummaryService } from "./orderSummary.service.js";

type MessageTypeKey = keyof typeof MessageType;
type MessageStatusKey = keyof typeof MessageStatus;

function asJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return value as Prisma.InputJsonValue;
}

function automationStatusFromMessageStatus(status: MessageStatusKey) {
  if (status === "DELIVERED") return AutomationSendStatus.DELIVERED;
  if (status === "READ") return AutomationSendStatus.READ;
  if (status === "FAILED") return AutomationSendStatus.FAILED;
  if (status === "SENT") return AutomationSendStatus.SENT;
  return null;
}

export const messageService = {
  async createOutboundMessage(input: {
    leadId: string;
    whatsappMessageId?: string;
    type: MessageTypeKey;
    content: string;
    status: MessageStatusKey;
    rawPayload?: unknown;
  }) {
    const message = await prisma.message.create({
      data: {
        leadId: input.leadId,
        whatsappMessageId: input.whatsappMessageId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType[input.type],
        content: input.content,
        status: MessageStatus[input.status],
        rawPayload: asJson(input.rawPayload)
      }
    });

    chatEventsService.publish({
      type: "message.created",
      leadId: input.leadId,
      payload: { message }
    });

    try {
      await leadScoringService.refreshLeadTemperature(input.leadId);
    } catch (error) {
      logger.error({ error, leadId: input.leadId }, "Failed to refresh lead temperature after outbound message");
    }

    return message;
  },

  async createInboundMessage(input: {
    leadId: string;
    whatsappMessageId: string;
    type: MessageTypeKey;
    content: string;
    rawPayload?: unknown;
  }) {
    try {
      const message = await prisma.message.create({
        data: {
          leadId: input.leadId,
          whatsappMessageId: input.whatsappMessageId,
          direction: MessageDirection.INBOUND,
          type: MessageType[input.type],
          content: input.content,
          status: MessageStatus.RECEIVED,
          rawPayload: asJson(input.rawPayload)
        }
      });

      chatEventsService.publish({
        type: "message.created",
        leadId: input.leadId,
        payload: { message }
      });

      try {
        await leadScoringService.refreshLeadTemperature(input.leadId);
      } catch (error) {
        logger.error({ error, leadId: input.leadId }, "Failed to refresh lead temperature after inbound message");
      }

      try {
        await humanActionService.analyzeInboundMessage(input.leadId, input.content);
      } catch (error) {
        logger.error({ error, leadId: input.leadId }, "Failed to analyze human attention for inbound message");
      }

      let order = null;
      try {
        order = await orderSummaryService.refreshFromConversation(input.leadId);
      } catch (error) {
        logger.error({ error, leadId: input.leadId }, "Failed to refresh order summary from inbound message");
      }

      if (order) {
        chatEventsService.publish({
          type: "order.updated",
          leadId: input.leadId,
          payload: { order }
        });
      }

      return { message, duplicate: false as const };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const message = await prisma.message.findUnique({
          where: { whatsappMessageId: input.whatsappMessageId }
        });
        return { message, duplicate: true as const };
      }

      throw error;
    }
  },

  async updateMessageStatus(whatsappMessageId: string, status: MessageStatusKey, rawPayload?: unknown) {
    const existing = await prisma.message.findUnique({ where: { whatsappMessageId } });
    if (!existing) {
      return null;
    }

    const data: Prisma.MessageUpdateInput = {
      status: MessageStatus[status]
    };

    if (rawPayload !== undefined) {
      data.rawPayload = asJson(rawPayload);
    }

    const updated = await prisma.message.update({
      where: { whatsappMessageId },
      data
    });

    const automationStatus = automationStatusFromMessageStatus(status);
    if (automationStatus) {
      await Promise.all([
        prisma.bulkMessageRecipient.updateMany({
          where: { whatsappMessageId },
          data: { status: automationStatus }
        }),
        prisma.campaignRecipient.updateMany({
          where: { whatsappMessageId },
          data: { status: automationStatus }
        })
      ]);
    }

    chatEventsService.publish({
      type: "message.status",
      leadId: updated.leadId,
      payload: { message: updated }
    });

    return updated;
  },

  async getRecentConversation(leadId: string, limit = 8) {
    const messages = await prisma.message.findMany({
      where: { leadId },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    return messages
      .reverse()
      .map((message) => `${message.direction === MessageDirection.INBOUND ? "Customer" : "Assistant"}: ${message.content}`)
      .join("\n");
  },

  async hasInitialTemplateMessage(leadId: string) {
    const count = await prisma.message.count({
      where: {
        leadId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEMPLATE
      }
    });

    return count > 0;
  },

  async createSendLog(input: {
    leadId?: string;
    action: string;
    status: string;
    errorMessage?: string;
  }) {
    return prisma.sendLog.create({
      data: input
    });
  }
};
