import { LeadStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { normalizePhoneNumber } from "../utils/phone.js";
import { leadScoringService } from "./leadScoring.service.js";

export type ImportedLead = {
  name: string;
  phone: string;
  rowNumber?: number;
  source?: string;
};

async function defaultCompanyId() {
  const company = await prisma.company.upsert({
    where: { slug: "printwear" },
    update: {},
    create: { name: "Printwear", slug: "printwear" }
  });
  return company.id;
}

function getPrismaErrorLogFields(error: unknown) {
  const prismaError = error as {
    code?: string;
    message?: string;
    meta?: unknown;
    name?: string;
    clientVersion?: string;
  };

  return {
    prismaError: {
      code: prismaError.code ?? null,
      message: prismaError.message ?? null,
      meta: prismaError.meta ?? null,
      name: prismaError.name ?? null,
      clientVersion: prismaError.clientVersion ?? null
    },
    prismaCode: prismaError.code,
    prismaMessage: prismaError.message,
    prismaMeta: prismaError.meta,
    prismaName: prismaError.name,
    prismaClientVersion: prismaError.clientVersion
  };
}

export const leadService = {
  async importLead(lead: ImportedLead, companyId?: string) {
    const phone = normalizePhoneNumber(lead.phone);
    if (!phone) {
      return { imported: false, reason: "invalid_phone" as const };
    }

    try {
      logger.info({ rowNumber: lead.rowNumber }, "Creating lead in database");
      await prisma.lead.create({
        data: {
          name: lead.name.trim() || "Unknown",
          companyId: companyId || await defaultCompanyId(),
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

      logger.error(
        {
          error,
          ...getPrismaErrorLogFields(error),
          rowNumber: lead.rowNumber
        },
        "Prisma lead insert error details"
      );
      throw new AppError(
        "Database insert failed",
        500,
        "Unable to insert lead into the database. Check DATABASE_URL and database connectivity."
      );
    }
  },

  async findNewLeadsForInitialMessages(limit = 100, companyId?: string) {
    try {
      logger.info({ limit }, "Loading leads pending welcome message from database");
      return await prisma.lead.findMany({
        where: { status: LeadStatus.NEW, ...(companyId ? { companyId } : {}) },
        orderBy: { createdAt: "asc" },
        take: limit
      });
    } catch (error) {
      logger.error({ error }, "Database read failed while loading pending welcome leads");
      throw new AppError(
        "Database read failed",
        500,
        "Unable to load pending welcome leads from the database. Check DATABASE_URL and database connectivity."
      );
    }
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

  async findOrCreateFromInbound(phoneValue: string, profileName?: string, companyId?: string) {
    const phone = normalizePhoneNumber(phoneValue);
    if (!phone) {
      throw new Error(`Invalid inbound phone number: ${phoneValue}`);
    }

    const ownerCompanyId = companyId || await defaultCompanyId();
    return prisma.lead.upsert({
      where: { companyId_phone: { companyId: ownerCompanyId, phone } },
      create: {
        companyId: ownerCompanyId,
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
