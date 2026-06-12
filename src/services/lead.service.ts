import { LeadStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { normalizePhoneNumber } from "../utils/phone.js";
import { leadScoringService } from "./leadScoring.service.js";

export type ImportedLead = {
  name: string;
  phone: string;
  rowNumber?: number;
  source?: string;
};

export const leadService = {
  async importLead(lead: ImportedLead) {
    const phone = normalizePhoneNumber(lead.phone);
    if (!phone) {
      return { imported: false, reason: "invalid_phone" as const };
    }

    try {
      await prisma.lead.create({
        data: {
          name: lead.name.trim() || "Unknown",
          phone,
          source: lead.source ?? "google_sheets",
          googleSheetRowNumber: lead.rowNumber,
          status: LeadStatus.NEW
        }
      });

      return { imported: true as const };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { imported: false, reason: "duplicate" as const };
      }

      throw error;
    }
  },

  async findNewLeadsForInitialMessages(limit = 100) {
    return prisma.lead.findMany({
      where: { status: LeadStatus.NEW },
      orderBy: { createdAt: "asc" },
      take: limit
    });
  },

  async markInitialMessageSent(leadId: string) {
    return prisma.lead.update({
      where: { id: leadId },
      data: { status: LeadStatus.MESSAGED }
    });
  },

  async markInitialMessageFailed(leadId: string) {
    return prisma.lead.update({
      where: { id: leadId },
      data: { status: LeadStatus.FAILED }
    });
  },

  async findOrCreateFromInbound(phoneValue: string, profileName?: string) {
    const phone = normalizePhoneNumber(phoneValue);
    if (!phone) {
      throw new Error(`Invalid inbound phone number: ${phoneValue}`);
    }

    return prisma.lead.upsert({
      where: { phone },
      create: {
        phone,
        name: profileName?.trim() || phone,
        source: "whatsapp",
        status: LeadStatus.REPLIED
      },
      update: {
        name: profileName?.trim() || undefined,
        status: LeadStatus.REPLIED
      }
    });
  },

  async markRepliedAndRefreshScore(leadId: string) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: LeadStatus.REPLIED }
    });
    return this.refreshLeadScore(leadId);
  },

  async refreshLeadScore(leadId: string) {
    return leadScoringService.refreshLeadTemperature(leadId);
  },

  async refreshAllLeadScores() {
    return leadScoringService.refreshAllLeadTemperatures();
  }
};
