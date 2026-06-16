import { MessageType, OrderStatus } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { chatEventsService } from "./chatEvents.service.js";
import { messageService } from "./message.service.js";
import { whatsappService } from "./whatsapp.service.js";

export type OrderAction = "CONFIRM" | "READY_FOR_DISPATCH" | "DISPATCH" | "CANCEL";

const actionConfig: Record<OrderAction, { status: OrderStatus; text: string }> = {
  CONFIRM: {
    status: OrderStatus.CONFIRMED,
    text: "Your order has been confirmed ✅ Our team will now proceed with the next steps."
  },
  READY_FOR_DISPATCH: {
    status: OrderStatus.READY_FOR_DISPATCH,
    text: "Your order is ready for dispatch 📦 We will share the delivery update shortly."
  },
  DISPATCH: {
    status: OrderStatus.DISPATCHED,
    text: "Your order has been dispatched 🚚 Thank you for choosing Printwear."
  },
  CANCEL: {
    status: OrderStatus.CANCELLED,
    text: "Your order has been cancelled. If this was a mistake or you need help, our team will assist you."
  }
};

export const orderActionService = {
  async perform(orderId: string, action: OrderAction, companyId?: string) {
    const config = actionConfig[action];
    const order = await prisma.orderSummary.findUnique({
      where: { id: orderId },
      include: { lead: true }
    });

    if (!order || (companyId && order.lead.companyId !== companyId)) {
      throw new Error("Order not found");
    }

    const sent = await whatsappService.sendTextMessage(order.lead.phone, config.text, order.lead.companyId);
    const message = await messageService.createOutboundMessage({
      leadId: order.leadId,
      whatsappMessageId: sent.messageId,
      type: MessageType.TEXT,
      content: config.text,
      status: "SENT",
      rawPayload: sent.rawResponse
    });

    const updatedOrder = await prisma.orderSummary.update({
      where: { id: orderId },
      data: { status: config.status }
    });

    chatEventsService.publish({
      type: "order.updated",
      leadId: order.leadId,
      payload: { order: updatedOrder }
    });

    return { order: updatedOrder, message };
  }
};
