import {
  AutomationSendStatus,
  BulkJobStatus,
  CampaignStatus,
  CampaignType,
  LeadStatus,
  MessageStatus,
  Prisma,
  WorkflowRunStatus,
  WorkflowTriggerType
} from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { importLeadsJob } from "../jobs/importLeads.job.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { normalizePhoneNumber } from "../utils/phone.js";
import { humanActionService } from "./humanAction.service.js";
import { leadService } from "./lead.service.js";
import { messageService } from "./message.service.js";
import { whatsappService } from "./whatsapp.service.js";

type ContactFilters = {
  search?: string;
  tag?: string;
  status?: keyof typeof LeadStatus;
  source?: string;
};

type AudienceFilter = {
  leadIds?: string[];
  tag?: string;
  status?: keyof typeof LeadStatus;
  source?: string;
  search?: string;
};

type WorkflowNode = {
  id: string;
  type: string;
  label?: string;
  config?: Record<string, unknown>;
};

type WorkflowEdge = {
  from: string;
  to: string;
};

type WorkflowDefinition = {
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
};

const activeBulkJobs = new Set<string>();
const activeCampaigns = new Set<string>();
let workersStarted = false;

type AutomationSetupStatus = {
  ready: boolean;
  missingTables: string[];
  missingLeadColumns: string[];
  migrationName: string;
};

const AUTOMATION_MIGRATION_NAME = "20260615120000_printwear_automation_modules";
const REQUIRED_TABLES = [
  "BulkMessageJob",
  "BulkMessageRecipient",
  "Campaign",
  "CampaignRecipient",
  "AdDraft",
  "AiWorkflow",
  "WorkflowExecutionLog"
];
const REQUIRED_LEAD_COLUMNS = ["tags", "attributes"];

let setupCache: { checkedAt: number; status: AutomationSetupStatus } | null = null;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setupRequiredDetails(status: AutomationSetupStatus) {
  return {
    setupRequired: true,
    missingMigrations: [status.migrationName],
    missingTables: status.missingTables,
    missingLeadColumns: status.missingLeadColumns,
    message: "Run the Printwear automation Prisma migration before using Contacts, Bulk Messaging, Campaigns, Ads, or AI Flows."
  };
}

function setupRequiredResponse(status: AutomationSetupStatus) {
  const setupRequired = !status.ready;

  return {
    setupRequired,
    migrationName: status.migrationName,
    missingTables: status.missingTables,
    missingLeadColumns: status.missingLeadColumns,
    message: setupRequired ? "Setup Required" : "Ready"
  };
}

async function automationSetupStatus(force = false): Promise<AutomationSetupStatus> {
  if (!force && setupCache && Date.now() - setupCache.checkedAt < 30000) {
    return setupCache.status;
  }

  try {
    const tableRows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('BulkMessageJob', 'BulkMessageRecipient', 'Campaign', 'CampaignRecipient', 'AdDraft', 'AiWorkflow', 'WorkflowExecutionLog')
    `;
    const columnRows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Lead'
        AND column_name IN ('tags', 'attributes')
    `;

    const existingTables = new Set(tableRows.map((row) => row.table_name));
    const existingColumns = new Set(columnRows.map((row) => row.column_name));
    const status = {
      ready: REQUIRED_TABLES.every((name) => existingTables.has(name)) && REQUIRED_LEAD_COLUMNS.every((name) => existingColumns.has(name)),
      missingTables: REQUIRED_TABLES.filter((name) => !existingTables.has(name)),
      missingLeadColumns: REQUIRED_LEAD_COLUMNS.filter((name) => !existingColumns.has(name)),
      migrationName: AUTOMATION_MIGRATION_NAME
    };
    setupCache = { checkedAt: Date.now(), status };
    return status;
  } catch (error) {
    logger.error({ error }, "Automation setup check failed");
    const status = {
      ready: false,
      missingTables: REQUIRED_TABLES,
      missingLeadColumns: REQUIRED_LEAD_COLUMNS,
      migrationName: AUTOMATION_MIGRATION_NAME
    };
    setupCache = { checkedAt: Date.now(), status };
    return status;
  }
}

async function assertAutomationSetup() {
  const status = await automationSetupStatus();
  if (!status.ready) {
    throw new AppError("Setup Required", 503, setupRequiredDetails(status));
  }
}

function tagsFromValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  }

  return String(value ?? "")
    .split(/[,\n]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function uniqueTags(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function csvRows(csvText: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function csvIndex(headers: string[], names: string[], fallback: number) {
  const index = headers.findIndex((header) => names.includes(header.toLowerCase().replace(/\s+/g, "")));
  return index >= 0 ? index : fallback;
}

function templateContent(templateName: string, source: string) {
  return `[WhatsApp template: ${templateName}] Sent by ${source}.`;
}

function campaignAudienceLabel(audience: Prisma.JsonValue) {
  const value = audience as AudienceFilter;
  if (value?.leadIds?.length) return `${value.leadIds.length} selected contacts`;
  if (value?.tag) return `Tag: ${value.tag}`;
  if (value?.status) return `Status: ${value.status}`;
  if (value?.source) return `Source: ${value.source}`;
  return "All contacts";
}

function workflowDefinition(value: Prisma.JsonValue): WorkflowDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { nodes: [], edges: [] };
  }

  return value as WorkflowDefinition;
}

function stringConfig(node: WorkflowNode, key: string, fallback = "") {
  const value = node.config?.[key];
  return typeof value === "string" ? value : fallback;
}

function audienceWhere(input: AudienceFilter = {}): Prisma.LeadWhereInput {
  return {
    ...(input.leadIds?.length ? { id: { in: input.leadIds } } : {}),
    ...(input.status ? { status: LeadStatus[input.status] } : {}),
    ...(input.source ? { source: { equals: input.source, mode: "insensitive" } } : {}),
    ...(input.search
      ? {
          OR: [
            { name: { contains: input.search, mode: "insensitive" } },
            { phone: { contains: input.search, mode: "insensitive" } },
            { source: { contains: input.search, mode: "insensitive" } }
          ]
        }
      : {})
  };
}

async function selectAudience(input: AudienceFilter = {}) {
  await assertAutomationSetup();
  let leadIds = input.leadIds ?? [];
  if (input.tag) {
    const tagRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Lead" WHERE ${input.tag.toLowerCase()} = ANY(tags)
    `;
    const tagLeadIds = tagRows.map((row) => row.id);
    leadIds = leadIds.length ? leadIds.filter((id) => tagLeadIds.includes(id)) : tagLeadIds;
  }

  return prisma.lead.findMany({
    where: audienceWhere({ ...input, leadIds }),
    orderBy: { updatedAt: "desc" }
  });
}

async function updateLeadTags(leadId: string, nextTags: string[]) {
  await assertAutomationSetup();
  const tags = uniqueTags(nextTags);
  if (!tags.length) return null;
  await prisma.$executeRaw`
    UPDATE "Lead"
    SET tags = (
      SELECT ARRAY(SELECT DISTINCT unnest(tags || ${tags}::text[]))
    )
    WHERE id = ${leadId}
  `;
  return prisma.lead.findUnique({ where: { id: leadId } });
}

async function updateLeadAttribute(leadId: string, key: string, value: unknown) {
  await assertAutomationSetup();
  if (!key) return null;
  await prisma.$executeRaw`
    UPDATE "Lead"
    SET attributes = COALESCE(attributes, '{}'::jsonb) || ${JSON.stringify({ [key]: value })}::jsonb
    WHERE id = ${leadId}
  `;
  return prisma.lead.findUnique({ where: { id: leadId } });
}

async function refreshBulkJobCounts(jobId: string) {
  const [sentCount, failedCount, queuedCount] = await Promise.all([
    prisma.bulkMessageRecipient.count({
      where: { bulkMessageJobId: jobId, status: { in: [AutomationSendStatus.SENT, AutomationSendStatus.DELIVERED, AutomationSendStatus.READ] } }
    }),
    prisma.bulkMessageRecipient.count({ where: { bulkMessageJobId: jobId, status: AutomationSendStatus.FAILED } }),
    prisma.bulkMessageRecipient.count({ where: { bulkMessageJobId: jobId, status: AutomationSendStatus.QUEUED } })
  ]);

  return prisma.bulkMessageJob.update({
    where: { id: jobId },
    data: {
      sentCount,
      failedCount,
      status: queuedCount > 0 ? BulkJobStatus.RUNNING : failedCount > 0 ? BulkJobStatus.FAILED : BulkJobStatus.COMPLETED
    }
  });
}

async function refreshCampaignCounts(campaignId: string) {
  const [sentCount, failedCount, queuedCount] = await Promise.all([
    prisma.campaignRecipient.count({
      where: { campaignId, status: { in: [AutomationSendStatus.SENT, AutomationSendStatus.DELIVERED, AutomationSendStatus.READ] } }
    }),
    prisma.campaignRecipient.count({ where: { campaignId, status: AutomationSendStatus.FAILED } }),
    prisma.campaignRecipient.count({ where: { campaignId, status: AutomationSendStatus.QUEUED } })
  ]);

  return prisma.campaign.update({
    where: { id: campaignId },
    data: {
      sentCount,
      failedCount,
      status: queuedCount > 0 ? CampaignStatus.RUNNING : failedCount > 0 ? CampaignStatus.FAILED : CampaignStatus.COMPLETED
    }
  });
}

async function sendTemplateToLead(input: {
  leadId: string;
  phone: string;
  customerName: string;
  templateName: string;
  templateLanguage: string;
  source: string;
}) {
  const sent = await whatsappService.sendNamedTemplateMessage({
    phone: input.phone,
    templateName: input.templateName,
    templateLanguage: input.templateLanguage,
    parameters: [{ type: "text", text: input.customerName || "there" }]
  });

  await messageService.createOutboundMessage({
    leadId: input.leadId,
    whatsappMessageId: sent.messageId,
    type: "TEMPLATE",
    content: templateContent(input.templateName, input.source),
    status: "SENT",
    rawPayload: {
      ...((sent.rawResponse ?? {}) as Record<string, unknown>),
      automationSource: input.source,
      templateName: input.templateName
    }
  });

  await prisma.lead.update({
    where: { id: input.leadId },
    data: { status: LeadStatus.MESSAGED }
  });

  return sent.messageId;
}

function campaignSummary(campaign: Prisma.CampaignGetPayload<{ include: { recipients: { include: { lead: true } } } }>) {
  const firstSentAt = campaign.recipients
    .map((recipient) => recipient.sentAt?.getTime() ?? 0)
    .filter(Boolean)
    .sort((a, b) => a - b)[0];

  const replies = campaign.recipients.reduce((count, recipient) => {
    if (!firstSentAt) return count;
    return count + Number(recipient.lead.status === LeadStatus.REPLIED && recipient.lead.updatedAt.getTime() >= firstSentAt);
  }, 0);

  return {
    id: campaign.id,
    name: campaign.name,
    type: campaign.type,
    audience: campaign.audience,
    audienceLabel: campaignAudienceLabel(campaign.audience),
    templateName: campaign.templateName,
    templateLanguage: campaign.templateLanguage,
    messagePreview: campaign.messagePreview,
    scheduledAt: campaign.scheduledAt,
    status: campaign.status,
    audienceCount: campaign.totalCount,
    sent: campaign.sentCount,
    failed: campaign.failedCount,
    replies,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt
  };
}

export const automationService = {
  async setupStatus() {
    const status = await automationSetupStatus(true);
    return setupRequiredResponse(status);
  },

  async listContacts(filters: ContactFilters = {}) {
    await assertAutomationSetup();
    const rows = await prisma.$queryRaw<Array<{
      id: string;
      name: string;
      phone: string;
      tags: string[];
      source: string;
      status: string;
      last_contacted: Date | null;
      updated_at: Date;
    }>>`
      SELECT
        l.id,
        l.name,
        l.phone,
        l.tags,
        l.source,
        l.status::text AS status,
        (
          SELECT m."createdAt"
          FROM "Message" m
          WHERE m."leadId" = l.id AND m.direction = 'outbound'
          ORDER BY m."createdAt" DESC
          LIMIT 1
        ) AS last_contacted,
        l."updatedAt" AS updated_at
      FROM "Lead" l
      ORDER BY l."updatedAt" DESC
    `;

    const search = filters.search?.toLowerCase();
    const filtered = rows.filter((lead) => {
      const matchesSearch = !search || `${lead.name} ${lead.phone}`.toLowerCase().includes(search);
      const matchesTag = !filters.tag || (lead.tags ?? []).includes(filters.tag.toLowerCase());
      const matchesStatus = !filters.status || lead.status === filters.status.toLowerCase();
      const matchesSource = !filters.source || lead.source.toLowerCase() === filters.source.toLowerCase();
      return matchesSearch && matchesTag && matchesStatus && matchesSource;
    });

    return {
      contacts: filtered.map((lead) => ({
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        tags: lead.tags ?? [],
        source: lead.source,
        status: lead.status.toUpperCase(),
        lastContacted: lead.last_contacted,
        updatedAt: lead.updated_at
      })),
      facets: {
        tags: uniqueTags(rows.flatMap((lead) => lead.tags ?? [])).sort(),
        sources: [...new Set(rows.map((lead) => lead.source).filter(Boolean))].sort(),
        statuses: Object.values(LeadStatus)
      }
    };
  },

  async createContact(input: { name: string; phone: string; tags?: string[]; source?: string }) {
    await assertAutomationSetup();
    const phone = normalizePhoneNumber(input.phone);
    if (!phone) throw new AppError("Enter a valid WhatsApp phone number", 400);

    const tags = uniqueTags(input.tags ?? []);
    const lead = await prisma.lead.upsert({
      where: { phone },
      create: {
        name: input.name.trim() || phone,
        phone,
        source: input.source?.trim() || "manual",
        status: LeadStatus.NEW
      },
      update: {
        name: input.name.trim() || undefined,
        source: input.source?.trim() || undefined
      }
    });

    await prisma.$executeRaw`
      UPDATE "Lead"
      SET tags = ${tags}::text[]
      WHERE id = ${lead.id}
    `;

    return lead;
  },

  async importContactsFromCsv(input: { csvText: string; source?: string; defaultTags?: string[] }) {
    await assertAutomationSetup();
    const rows = csvRows(input.csvText);
    if (!rows.length) throw new AppError("Upload or paste a CSV with at least one contact", 400);

    const headers = rows[0].map((item) => item.toLowerCase());
    const hasHeader = headers.some((item) => ["name", "phone", "tags", "source"].includes(item.replace(/\s+/g, "")));
    const dataRows = hasHeader ? rows.slice(1) : rows;
    const nameIndex = hasHeader ? csvIndex(headers, ["name", "fullname", "customer"], 0) : 0;
    const phoneIndex = hasHeader ? csvIndex(headers, ["phone", "phonenumber", "whatsapp", "mobile"], 1) : 1;
    const tagIndex = hasHeader ? csvIndex(headers, ["tags", "tag"], 2) : 2;
    const sourceIndex = hasHeader ? csvIndex(headers, ["source"], 3) : 3;

    let imported = 0;
    let skipped = 0;

    for (const row of dataRows) {
      const phone = normalizePhoneNumber(row[phoneIndex] ?? "");
      if (!phone) {
        skipped += 1;
        continue;
      }

      const tags = uniqueTags([...tagsFromValue(row[tagIndex]), ...(input.defaultTags ?? [])]);
      const lead = await prisma.lead.upsert({
        where: { phone },
        create: {
          name: row[nameIndex]?.trim() || phone,
          phone,
          source: row[sourceIndex]?.trim() || input.source?.trim() || "csv",
          status: LeadStatus.NEW
        },
        update: {
          name: row[nameIndex]?.trim() || undefined,
          source: row[sourceIndex]?.trim() || input.source?.trim() || undefined
        }
      });
      await prisma.$executeRaw`
        UPDATE "Lead"
        SET tags = ${tags}::text[]
        WHERE id = ${lead.id}
      `;
      imported += 1;
    }

    logger.info({ imported, skipped }, "Contacts imported from CSV");
    await messageService.createSendLog({ action: "contacts_csv_import", status: "sent", errorMessage: `Imported ${imported}; skipped ${skipped}` });
    return { imported, skipped };
  },

  async importContactsFromGoogleSheets() {
    await assertAutomationSetup();
    const result = await importLeadsJob();
    logger.info(result, "Contacts imported from Google Sheets");
    return result;
  },

  async listBulkJobs() {
    await assertAutomationSetup();
    const jobs = await prisma.bulkMessageJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { recipients: { take: 200, include: { lead: true }, orderBy: { createdAt: "asc" } } }
    });

    return jobs.map((job) => ({
      id: job.id,
      name: job.name,
      templateName: job.templateName,
      status: job.status,
      totalCount: job.totalCount,
      sentCount: job.sentCount,
      failedCount: job.failedCount,
      queuedCount: job.recipients.filter((recipient) => recipient.status === AutomationSendStatus.QUEUED).length,
      createdAt: job.createdAt,
      recipients: job.recipients.map((recipient) => ({
        id: recipient.id,
        leadId: recipient.leadId,
        name: recipient.lead.name,
        phone: recipient.phone,
        status: recipient.status,
        errorMessage: recipient.errorMessage,
        sentAt: recipient.sentAt
      }))
    }));
  },

  async createBulkSend(input: { name: string; templateName: string; templateLanguage?: string; audience: AudienceFilter }) {
    await assertAutomationSetup();
    const leads = await selectAudience(input.audience);
    if (!leads.length) throw new AppError("No contacts matched this bulk-send audience", 400);

    const job = await prisma.bulkMessageJob.create({
      data: {
        name: input.name,
        templateName: input.templateName,
        templateLanguage: input.templateLanguage || env.WHATSAPP_TEMPLATE_LANGUAGE,
        totalCount: leads.length,
        recipients: {
          create: leads.map((lead) => ({
            leadId: lead.id,
            phone: lead.phone
          }))
        }
      }
    });

    logger.info({ jobId: job.id, count: leads.length, templateName: input.templateName }, "bulk send started");
    void this.processBulkJob(job.id);
    return job;
  },

  async processBulkJob(jobId: string) {
    if (activeBulkJobs.has(jobId)) return;
    activeBulkJobs.add(jobId);

    try {
      const job = await prisma.bulkMessageJob.update({
        where: { id: jobId },
        data: { status: BulkJobStatus.RUNNING },
        include: {
          recipients: {
            where: { status: AutomationSendStatus.QUEUED },
            include: { lead: true },
            orderBy: { createdAt: "asc" }
          }
        }
      });

      for (const recipient of job.recipients) {
        try {
          const whatsappMessageId = await sendTemplateToLead({
            leadId: recipient.leadId,
            phone: recipient.phone,
            customerName: recipient.lead.name,
            templateName: job.templateName,
            templateLanguage: job.templateLanguage,
            source: `bulk:${job.id}`
          });

          await prisma.bulkMessageRecipient.update({
            where: { id: recipient.id },
            data: { status: AutomationSendStatus.SENT, whatsappMessageId, sentAt: new Date() }
          });
          await messageService.createSendLog({ leadId: recipient.leadId, action: "bulk_message", status: "sent" });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown bulk send failure";
          logger.error({ error, jobId, leadId: recipient.leadId }, "failed message in bulk send");
          await prisma.bulkMessageRecipient.update({
            where: { id: recipient.id },
            data: { status: AutomationSendStatus.FAILED, errorMessage }
          });
          await messageService.createSendLog({ leadId: recipient.leadId, action: "bulk_message", status: "failed", errorMessage });
        }

        await delay(env.AUTOMATION_SEND_DELAY_MS);
      }

      await refreshBulkJobCounts(jobId);
    } catch (error) {
      logger.error({ error, jobId }, "Bulk send worker failed");
      await prisma.bulkMessageJob.update({ where: { id: jobId }, data: { status: BulkJobStatus.FAILED } }).catch(() => null);
    } finally {
      activeBulkJobs.delete(jobId);
    }
  },

  async listCampaigns() {
    await assertAutomationSetup();
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      include: { recipients: { include: { lead: true } } }
    });
    return campaigns.map(campaignSummary);
  },

  async campaignDetail(id: string) {
    await assertAutomationSetup();
    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        recipients: {
          include: {
            lead: {
              include: {
                messages: {
                  orderBy: { createdAt: "desc" },
                  take: 5
                }
              }
            }
          },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!campaign) throw new AppError("Campaign not found", 404);

    return {
      ...campaignSummary(campaign),
      recipients: campaign.recipients.map((recipient) => ({
        id: recipient.id,
        leadId: recipient.leadId,
        name: recipient.lead.name,
        phone: recipient.phone,
        status: recipient.status,
        errorMessage: recipient.errorMessage,
        sentAt: recipient.sentAt,
        latestReply: recipient.lead.messages.find((message) => message.direction === "INBOUND")?.content ?? null
      }))
    };
  },

  async createCampaign(input: {
    name: string;
    audience: AudienceFilter;
    templateName: string;
    templateLanguage?: string;
    messagePreview?: string;
    scheduledAt?: Date | null;
    scheduleNow?: boolean;
  }) {
    await assertAutomationSetup();
    const leads = await selectAudience(input.audience);
    if (!leads.length) throw new AppError("No contacts matched this campaign audience", 400);

    const status = input.scheduleNow
      ? CampaignStatus.RUNNING
      : input.scheduledAt
        ? CampaignStatus.SCHEDULED
        : CampaignStatus.DRAFT;

    const campaign = await prisma.campaign.create({
      data: {
        name: input.name,
        type: CampaignType.WHATSAPP_TEMPLATE,
        audience: input.audience as Prisma.InputJsonObject,
        templateName: input.templateName,
        templateLanguage: input.templateLanguage || env.WHATSAPP_TEMPLATE_LANGUAGE,
        messagePreview: input.messagePreview,
        scheduledAt: input.scheduledAt,
        status,
        totalCount: leads.length,
        recipients: {
          create: leads.map((lead) => ({
            leadId: lead.id,
            phone: lead.phone
          }))
        }
      }
    });

    logger.info({ campaignId: campaign.id, status, scheduledAt: campaign.scheduledAt }, "campaign scheduled");
    if (input.scheduleNow) void this.processCampaign(campaign.id);
    return campaign;
  },

  async pauseCampaign(id: string) {
    await assertAutomationSetup();
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new AppError("Campaign not found", 404);
    if (!( [CampaignStatus.SCHEDULED, CampaignStatus.RUNNING] as CampaignStatus[] ).includes(campaign.status)) {
      throw new AppError("Only scheduled or running campaigns can be paused", 400);
    }
    return prisma.campaign.update({ where: { id }, data: { status: CampaignStatus.PAUSED } });
  },

  async cancelCampaign(id: string) {
    await assertAutomationSetup();
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new AppError("Campaign not found", 404);
    if (!( [CampaignStatus.SCHEDULED, CampaignStatus.PAUSED, CampaignStatus.RUNNING] as CampaignStatus[] ).includes(campaign.status)) {
      throw new AppError("Only pending campaigns can be cancelled", 400);
    }
    return prisma.campaign.update({ where: { id }, data: { status: CampaignStatus.CANCELLED } });
  },

  async processCampaign(campaignId: string) {
    if (activeCampaigns.has(campaignId)) return;
    activeCampaigns.add(campaignId);

    try {
      const campaign = await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: CampaignStatus.RUNNING },
        include: {
          recipients: {
            where: { status: AutomationSendStatus.QUEUED },
            include: { lead: true },
            orderBy: { createdAt: "asc" }
          }
        }
      });

      logger.info({ campaignId, count: campaign.recipients.length }, "campaign executed");

      for (const recipient of campaign.recipients) {
        const current = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
        if (!current || ( [CampaignStatus.PAUSED, CampaignStatus.CANCELLED] as CampaignStatus[] ).includes(current.status)) break;

        try {
          const whatsappMessageId = await sendTemplateToLead({
            leadId: recipient.leadId,
            phone: recipient.phone,
            customerName: recipient.lead.name,
            templateName: campaign.templateName,
            templateLanguage: campaign.templateLanguage,
            source: `campaign:${campaign.id}`
          });

          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: { status: AutomationSendStatus.SENT, whatsappMessageId, sentAt: new Date() }
          });
          await messageService.createSendLog({ leadId: recipient.leadId, action: "campaign_message", status: "sent" });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown campaign send failure";
          logger.error({ error, campaignId, leadId: recipient.leadId }, "failed message in campaign");
          await prisma.campaignRecipient.update({
            where: { id: recipient.id },
            data: { status: AutomationSendStatus.FAILED, errorMessage }
          });
          await messageService.createSendLog({ leadId: recipient.leadId, action: "campaign_message", status: "failed", errorMessage });
        }

        await delay(env.AUTOMATION_SEND_DELAY_MS);
      }

      await refreshCampaignCounts(campaignId);
    } catch (error) {
      logger.error({ error, campaignId }, "Campaign worker failed");
      await prisma.campaign.update({ where: { id: campaignId }, data: { status: CampaignStatus.FAILED } }).catch(() => null);
    } finally {
      activeCampaigns.delete(campaignId);
    }
  },

  async processDueCampaigns() {
    const setup = await automationSetupStatus();
    if (!setup.ready) {
      logger.warn(setupRequiredDetails(setup), "Automation workers paused until setup is complete");
      return;
    }

    const campaigns = await prisma.campaign.findMany({
      where: {
        status: CampaignStatus.SCHEDULED,
        scheduledAt: { lte: new Date() }
      },
      take: 5,
      orderBy: { scheduledAt: "asc" }
    });

    for (const campaign of campaigns) {
      void this.processCampaign(campaign.id);
    }
  },

  async listAdDrafts() {
    await assertAutomationSetup();
    const drafts = await prisma.adDraft.findMany({ orderBy: { createdAt: "desc" } });
    return {
      metaConnected: Boolean(env.META_ADS_ACCESS_TOKEN && env.META_AD_ACCOUNT_ID),
      drafts
    };
  },

  async createAdDraft(input: {
    name: string;
    objective: string;
    audience: string;
    headline: string;
    bodyText: string;
    cta: string;
    destinationWhatsAppNumber: string;
    templatePreview: string;
  }) {
    await assertAutomationSetup();
    return prisma.adDraft.create({ data: input });
  },

  async listWorkflows() {
    await assertAutomationSetup();
    return prisma.aiWorkflow.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        executionLogs: {
          orderBy: { createdAt: "desc" },
          take: 5
        }
      }
    });
  },

  async createWorkflow(input: {
    name: string;
    triggerType: keyof typeof WorkflowTriggerType;
    triggerValue: string;
    isActive?: boolean;
    definition: WorkflowDefinition;
  }) {
    await assertAutomationSetup();
    return prisma.aiWorkflow.create({
      data: {
        name: input.name,
        triggerType: WorkflowTriggerType[input.triggerType],
        triggerValue: input.triggerValue,
        isActive: Boolean(input.isActive),
        definition: input.definition as Prisma.InputJsonObject
      }
    });
  },

  async updateWorkflow(id: string, input: Partial<{
    name: string;
    triggerType: keyof typeof WorkflowTriggerType;
    triggerValue: string;
    isActive: boolean;
    definition: WorkflowDefinition;
  }>) {
    await assertAutomationSetup();
    return prisma.aiWorkflow.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.triggerType !== undefined ? { triggerType: WorkflowTriggerType[input.triggerType] } : {}),
        ...(input.triggerValue !== undefined ? { triggerValue: input.triggerValue } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.definition !== undefined ? { definition: input.definition as Prisma.InputJsonObject } : {})
      }
    });
  },

  async executeMatchingWorkflows(input: { leadId: string; phone: string; text: string; source?: string }) {
    const setup = await automationSetupStatus();
    if (!setup.ready) {
      logger.warn(setupRequiredDetails(setup), "AI workflow execution skipped until setup is complete");
      return false;
    }

    const workflows = await prisma.aiWorkflow.findMany({ where: { isActive: true } });
    let executed = false;

    for (const workflow of workflows) {
      const trigger = workflow.triggerValue.trim();
      const text = input.text.trim();
      const matches =
        (workflow.triggerType === WorkflowTriggerType.KEYWORD && text.toLowerCase().includes(trigger.toLowerCase())) ||
        (workflow.triggerType === WorkflowTriggerType.REGEX && new RegExp(trigger, "i").test(text)) ||
        (workflow.triggerType === WorkflowTriggerType.AD && input.source?.toLowerCase().includes(trigger.toLowerCase())) ||
        (workflow.triggerType === WorkflowTriggerType.TEMPLATE && text.toLowerCase().includes(trigger.toLowerCase()));

      if (!matches) continue;

      executed = true;
      logger.info({ workflowId: workflow.id, leadId: input.leadId }, "workflow triggered");
      await prisma.workflowExecutionLog.create({
        data: { workflowId: workflow.id, leadId: input.leadId, status: WorkflowRunStatus.STARTED }
      });

      try {
        await this.executeWorkflow(workflow.id, input.leadId);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Workflow failed";
        logger.error({ error, workflowId: workflow.id, leadId: input.leadId }, "Workflow execution failed");
        await prisma.workflowExecutionLog.create({
          data: { workflowId: workflow.id, leadId: input.leadId, status: WorkflowRunStatus.FAILED, errorMessage }
        });
        await humanActionService.request(input.leadId, `Workflow failed: ${errorMessage}`).catch(() => null);
      }
    }

    return executed;
  },

  async executeWorkflow(workflowId: string, leadId: string) {
    const workflow = await prisma.aiWorkflow.findUnique({ where: { id: workflowId } });
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!workflow || !lead) return;

    const definition = workflowDefinition(workflow.definition);
    const nodes = definition.nodes ?? [];
    const edges = definition.edges ?? [];
    const startNode = nodes.find((node) => node.type === "start") ?? nodes[0];
    const visited = new Set<string>();
    let current: WorkflowNode | undefined = startNode;

    while (current && !visited.has(current.id) && visited.size < 50) {
      visited.add(current.id);
      logger.info({ workflowId, leadId, stepId: current.id, stepType: current.type }, "workflow step executed");

      await prisma.workflowExecutionLog.create({
        data: { workflowId, leadId, status: WorkflowRunStatus.EXECUTED, stepKey: `${current.type}:${current.id}` }
      });

      if (current.type === "text") {
        const text = stringConfig(current, "text", "Thanks for your message. Our team will help shortly.");
        const sent = await whatsappService.sendTextMessage(lead.phone, text);
        await messageService.createOutboundMessage({
          leadId,
          whatsappMessageId: sent.messageId,
          type: "TEXT",
          content: text,
          status: "SENT",
          rawPayload: { ...((sent.rawResponse ?? {}) as Record<string, unknown>), automationSource: `workflow:${workflow.id}` }
        });
      }

      if (current.type === "template") {
        const templateName = stringConfig(current, "templateName", env.WHATSAPP_TEMPLATE_NAME || "");
        if (!templateName) throw new AppError("Workflow template block needs a template name", 400);
        await sendTemplateToLead({
          leadId,
          phone: lead.phone,
          customerName: lead.name,
          templateName,
          templateLanguage: stringConfig(current, "templateLanguage", env.WHATSAPP_TEMPLATE_LANGUAGE),
          source: `workflow:${workflow.id}`
        });
      }

      if (current.type === "delay") {
        const seconds = Math.min(30, Math.max(1, Number(current.config?.seconds ?? 2)));
        await delay(seconds * 1000);
      }

      if (current.type === "add_tag") {
        await updateLeadTags(leadId, tagsFromValue(current.config?.tag || current.config?.tags));
      }

      if (current.type === "set_attribute") {
        const key = stringConfig(current, "key");
        if (key) await updateLeadAttribute(leadId, key, current.config?.value ?? "");
      }

      if (current.type === "human_takeover") {
        await humanActionService.request(leadId, stringConfig(current, "reason", "AI workflow requested human takeover"));
      }

      if (current.type === "api_request") {
        logger.info({ workflowId, leadId, url: stringConfig(current, "url") }, "Workflow API request block logged for integration");
      }

      const nextEdge = edges.find((edge) => edge.from === current?.id);
      current = nextEdge ? nodes.find((node) => node.id === nextEdge.to) : undefined;
    }
  },

  startWorkers() {
    if (workersStarted) return;
    workersStarted = true;

    windowlessInterval(async () => {
      const setup = await automationSetupStatus();
      if (!setup.ready) {
        logger.warn(setupRequiredDetails(setup), "Automation workers paused until setup is complete");
        return;
      }

      await this.processDueCampaigns();
      const queuedBulkJobs = await prisma.bulkMessageJob.findMany({
        where: { status: BulkJobStatus.QUEUED },
        take: 2,
        orderBy: { createdAt: "asc" }
      });
      queuedBulkJobs.forEach((job) => void this.processBulkJob(job.id));
    }, 15000);
  }
};

function windowlessInterval(fn: () => Promise<void>, ms: number) {
  setInterval(() => {
    fn().catch((error) => logger.error({ error }, "Automation worker tick failed"));
  }, ms);
}
