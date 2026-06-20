import { OrderStatus } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { orderSummaryService } from "./orderSummary.service.js";
import { printwearSheetService } from "./printwearSheet.service.js";

export const printwearOrderService = {
  async detectOrCreateOrder(tenantId: string, leadId: string) {
    const order = await orderSummaryService.refreshFromConversation(leadId);
    if (order) {
      await printwearSheetService.updateOrderStatus(tenantId, leadId, order.status).catch(() => null);
    }
    return order;
  },

  async updateOrderFromConversation(tenantId: string, leadId: string) {
    return this.detectOrCreateOrder(tenantId, leadId);
  },

  async list(tenantId: string) {
    const pipeline = await orderSummaryService.listPipeline(tenantId);
    return Object.values(pipeline).flat().sort(
      (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
    );
  },

  async updateStatus(tenantId: string, orderId: string, status: OrderStatus) {
    const order = await orderSummaryService.updateStatus(orderId, status, tenantId);
    await printwearSheetService.updateOrderStatus(tenantId, order.leadId, order.status).catch(() => null);
    return order;
  },

  async stats(tenantId: string) {
    const [ordersCaptured, confirmed, draft] = await Promise.all([
      prisma.orderSummary.count({ where: { lead: { companyId: tenantId } } }),
      prisma.orderSummary.count({ where: { lead: { companyId: tenantId }, status: OrderStatus.CONFIRMED } }),
      prisma.orderSummary.count({ where: { lead: { companyId: tenantId }, status: { in: [OrderStatus.COLLECTING_DETAILS, OrderStatus.READY_FOR_REVIEW, OrderStatus.QUOTATION_NEEDED] } } })
    ]);

    return { ordersCaptured, confirmed, draft };
  }
};
