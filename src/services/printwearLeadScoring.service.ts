import { LeadTemperature, MessageDirection } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { chatEventsService } from "./chatEvents.service.js";

function temperatureFromInboundReplies(customerReplyCount: number) {
  if (customerReplyCount >= 6) {
    return {
      leadTemperature: LeadTemperature.HOT,
      temperatureReason: "6 or more inbound customer replies"
    };
  }

  if (customerReplyCount >= 2) {
    return {
      leadTemperature: LeadTemperature.WARM,
      temperatureReason: "2-5 inbound customer replies"
    };
  }

  return {
    leadTemperature: LeadTemperature.SCRAP,
    temperatureReason: "0-1 inbound customer replies"
  };
}

export const printwearLeadScoringService = {
  temperatureFromInboundReplies,

  async recalculateLeadTemperature(leadId: string) {
    const customerReplyCount = await prisma.message.count({
      where: {
        leadId,
        direction: MessageDirection.INBOUND
      }
    });
    const score = temperatureFromInboundReplies(customerReplyCount);

    const lead = await prisma.lead.update({
      where: { id: leadId },
      data: {
        messageCount: customerReplyCount,
        leadTemperature: score.leadTemperature,
        temperatureReason: score.temperatureReason
      }
    });

    chatEventsService.publish({
      type: "lead.updated",
      leadId,
      payload: { lead }
    });

    return lead;
  },

  async updateDashboardMetrics(tenantId: string) {
    const [totalLeads, hotLeads, warmLeads, scrapLeads] = await Promise.all([
      prisma.lead.count({ where: { companyId: tenantId } }),
      prisma.lead.count({ where: { companyId: tenantId, leadTemperature: LeadTemperature.HOT } }),
      prisma.lead.count({ where: { companyId: tenantId, leadTemperature: LeadTemperature.WARM } }),
      prisma.lead.count({ where: { companyId: tenantId, leadTemperature: LeadTemperature.SCRAP } })
    ]);

    return { totalLeads, hotLeads, warmLeads, scrapLeads };
  }
};
