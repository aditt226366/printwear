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
import { apiUsageService } from "./apiUsage.service.js";
import { companyIntegrationService } from "./companyIntegration.service.js";
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

type ContactTemplateInput = {
  name: string;
  category?: string;
  language?: string;
  body: string;
  headerText?: string | null;
  footerText?: string | null;
};

const activeBulkJobs = new Set<string>();
const activeCampaigns = new Set<string>();
let workersStarted = false;
const CONTACT_BROADCAST_SEND_DELAY_MS = 6000;

type AutomationSetupStatus = {
  ready: boolean;
  missingTables: string[];
  missingLeadColumns: string[];
  migrationName: string;
};

const AUTOMATION_MIGRATION_NAME = "20260615120000_printwear_automation_modules";
const REQUIRED_TABLES = [
  "ContactBroadcastTemplate",
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
        AND table_name IN ('ContactBroadcastTemplate', 'BulkMessageJob', 'BulkMessageRecipient', 'Campaign', 'CampaignRecipient', 'AdDraft', 'AiWorkflow', 'WorkflowExecutionLog')
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

function normalizeTemplateName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeTemplateCategory(value: unknown) {
  const category = String(value || "MARKETING").trim().toUpperCase();
  return ["MARKETING", "UTILITY", "AUTHENTICATION"].includes(category) ? category : "MARKETING";
}

function normalizeTemplateLanguage(value: unknown) {
  return String(value || "en_US").trim() || "en_US";
}

function graphErrorMessage(data: unknown) {
  if (!data || typeof data !== "object") return null;
  const error = (data as { error?: { message?: string } }).error;
  return error?.message ?? null;
}

function contactTemplateStatusFromMeta(status: unknown) {
  const value = String(status || "").trim().toUpperCase();
  if (value === "APPROVED" || value === "ACCEPTED") return "ACCEPTED";
  if (value === "REJECTED") return "REJECTED";
  if (value === "PAUSED" || value === "DISABLED") return "NEEDS_ATTENTION";
  if (value === "PENDING" || value === "IN_REVIEW" || value === "SUBMITTED") return "PENDING";
  return value || "SUBMITTED";
}

function templateComponents(input: ContactTemplateInput) {
  const components: Array<Record<string, string>> = [];
  const headerText = input.headerText?.trim();
  if (headerText) components.push({ type: "HEADER", format: "TEXT", text: headerText });
  components.push({ type: "BODY", text: input.body.trim() });
  const footerText = input.footerText?.trim();
  if (footerText) components.push({ type: "FOOTER", text: footerText });
  return components;
}

function bodyFromMetaComponents(components: unknown) {
  if (!Array.isArray(components)) return "";
  const body = components.find((component) => (
    component &&
    typeof component === "object" &&
    String((component as { type?: unknown }).type || "").toUpperCase() === "BODY"
  )) as { text?: string } | undefined;
  return body?.text ?? "";
}

async function graphRequest(input: {
  companyId: string;
  method: "GET" | "POST";
  path: string;
  accessToken: string;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  purpose: string;
}) {
  const url = new URL(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}${input.path}`);
  Object.entries(input.params ?? {}).forEach(([key, value]) => url.searchParams.set(key, value));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      method: input.method,
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json"
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    void apiUsageService.log({
      companyId: input.companyId,
      provider: "META_WHATSAPP",
      endpoint: input.path,
      method: input.method,
      statusCode: response.status,
      success: response.ok,
      metadata: {
        purpose: input.purpose,
        templateName: typeof input.body?.name === "string" ? input.body.name : input.params?.name,
        error: graphErrorMessage(data)
      }
    });
    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function findMetaTemplate(input: {
  companyId: string;
  businessAccountId: string;
  accessToken: string;
  name: string;
  language: string;
}) {
  const result = await graphRequest({
    companyId: input.companyId,
    method: "GET",
    path: `/${input.businessAccountId}/message_templates`,
    accessToken: input.accessToken,
    params: {
      fields: "id,name,language,status,rejected_reason,components",
      limit: "100"
    },
    purpose: "contact_template_sync"
  });

  if (!result.response.ok) {
    throw new AppError(
      "WhatsApp template sync failed",
      result.response.status >= 400 && result.response.status < 500 ? 400 : 500,
      graphErrorMessage(result.data) ?? `Meta API returned HTTP ${result.response.status}`
    );
  }

  const rows = (result.data as {
    data?: Array<{
      id?: string;
      name?: string;
      language?: string;
      status?: string;
      rejected_reason?: string;
      components?: unknown;
    }>;
  }).data ?? [];

  return rows.find((row) => row.name === input.name && row.language === input.language) ?? null;
}

function publicContactTemplate(template: {
  id: string;
  name: string;
  category: string;
  language: string;
  body: string;
  headerText: string | null;
  footerText: string | null;
  metaTemplateId: string | null;
  metaStatus: string | null;
  status: string;
  rejectionReason: string | null;
  lastSubmittedAt: Date | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: template.id,
    name: template.name,
    category: template.category,
    language: template.language,
    body: template.body,
    headerText: template.headerText,
    footerText: template.footerText,
    metaTemplateId: template.metaTemplateId,
    metaStatus: template.metaStatus,
    status: template.status,
    accepted: template.status === "ACCEPTED",
    rejectionReason: template.rejectionReason,
    lastSubmittedAt: template.lastSubmittedAt,
    lastSyncedAt: template.lastSyncedAt,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt
  };
}

async function syncContactTemplateRecord(template: { id: string; companyId: string; name: string; language: string }) {
  const whatsApp = await companyIntegrationService.whatsApp(template.companyId);
  const metaTemplate = await findMetaTemplate({
    companyId: template.companyId,
    businessAccountId: whatsApp.businessAccountId,
    accessToken: whatsApp.accessToken,
    name: template.name,
    language: template.language
  });

  if (!metaTemplate) {
    return prisma.contactBroadcastTemplate.update({
      where: { id: template.id },
      data: {
        status: "ERROR",
        rejectionReason: "Template not found in Meta.",
        lastSyncedAt: new Date()
      }
    });
  }

  return prisma.contactBroadcastTemplate.update({
    where: { id: template.id },
    data: {
      metaTemplateId: metaTemplate.id ?? null,
      metaStatus: metaTemplate.status ?? null,
      status: contactTemplateStatusFromMeta(metaTemplate.status),
      rejectionReason: metaTemplate.rejected_reason ?? null,
      lastSyncedAt: new Date()
    }
  });
}

async function ensureAcceptedContactTemplate(companyId: string, templateName: string, templateLanguage: string) {
  const name = normalizeTemplateName(templateName);
  const language = normalizeTemplateLanguage(templateLanguage);
  if (!name) throw new AppError("Template name is required.", 400);

  const local = await prisma.contactBroadcastTemplate.findUnique({
    where: { companyId_name_language: { companyId, name, language } }
  });

  if (local?.status === "ACCEPTED") return local;
  if (local) {
    const synced = await syncContactTemplateRecord(local);
    if (synced.status === "ACCEPTED") return synced;
    throw new AppError("Template is not accepted by Meta yet.", 400, `Current template status: ${synced.status}`);
  }

  const whatsApp = await companyIntegrationService.whatsApp(companyId);
  const metaTemplate = await findMetaTemplate({
    companyId,
    businessAccountId: whatsApp.businessAccountId,
    accessToken: whatsApp.accessToken,
    name,
    language
  });

  if (!metaTemplate || contactTemplateStatusFromMeta(metaTemplate.status) !== "ACCEPTED") {
    throw new AppError("Template is not accepted by Meta yet.", 400);
  }

  return prisma.contactBroadcastTemplate.create({
    data: {
      companyId,
      name,
      category: "MARKETING",
      language,
      body: bodyFromMetaComponents(metaTemplate.components) || `Approved WhatsApp template ${name}`,
      metaTemplateId: metaTemplate.id ?? null,
      metaStatus: metaTemplate.status ?? null,
      status: "ACCEPTED",
      lastSyncedAt: new Date()
    }
  });
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

function audienceWhere(input: AudienceFilter = {}, companyId?: string): Prisma.LeadWhereInput {
  return {
    ...(companyId ? { companyId } : {}),
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

async function selectAudience(input: AudienceFilter = {}, companyId?: string) {
  await assertAutomationSetup();
  const scopedCompanyId = companyId ?? null;
  let leadIds = input.leadIds ?? [];
  if (input.tag) {
    const tagRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Lead" WHERE ${input.tag.toLowerCase()} = ANY(tags) AND (${scopedCompanyId}::text IS NULL OR "companyId" = ${scopedCompanyId})
    `;
    const tagLeadIds = tagRows.map((row) => row.id);
    leadIds = leadIds.length ? leadIds.filter((id) => tagLeadIds.includes(id)) : tagLeadIds;
  }

  return prisma.lead.findMany({
    where: audienceWhere({ ...input, leadIds }, companyId),
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
  companyId: string;
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
    companyId: input.companyId,
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

  async listContactTemplates(companyId: string) {
    await assertAutomationSetup();
    const templates = await prisma.contactBroadcastTemplate.findMany({
      where: { companyId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });
    return templates.map(publicContactTemplate);
  },

  async submitContactTemplate(input: ContactTemplateInput, companyId: string, actorUserId?: string | null) {
    await assertAutomationSetup();
    const name = normalizeTemplateName(input.name);
    const language = normalizeTemplateLanguage(input.language);
    const category = normalizeTemplateCategory(input.category);
    const body = input.body.trim();
    if (!name) throw new AppError("Template name is required.", 400);
    if (!body) throw new AppError("Template content is required.", 400);

    const whatsApp = await companyIntegrationService.whatsApp(companyId);
    const payload = {
      name,
      category,
      language,
      components: templateComponents({ ...input, name, category, language, body })
    };
    const result = await graphRequest({
      companyId,
      method: "POST",
      path: `/${whatsApp.businessAccountId}/message_templates`,
      accessToken: whatsApp.accessToken,
      body: payload,
      purpose: "contact_template_submit"
    });
    const meta = result.data as { id?: string; status?: string; category?: string };
    const nextStatus = result.response.ok ? contactTemplateStatusFromMeta(meta.status || "SUBMITTED") : "ERROR";
    const rejectionReason = result.response.ok ? null : graphErrorMessage(result.data) ?? `Meta API returned HTTP ${result.response.status}`;

    const template = await prisma.contactBroadcastTemplate.upsert({
      where: { companyId_name_language: { companyId, name, language } },
      create: {
        companyId,
        name,
        category,
        language,
        body,
        headerText: input.headerText?.trim() || null,
        footerText: input.footerText?.trim() || null,
        metaTemplateId: meta.id ?? null,
        metaStatus: meta.status ?? null,
        status: nextStatus,
        rejectionReason,
        lastSubmittedAt: new Date(),
        lastSyncedAt: result.response.ok ? new Date() : null,
        createdById: actorUserId ?? null
      },
      update: {
        category,
        body,
        headerText: input.headerText?.trim() || null,
        footerText: input.footerText?.trim() || null,
        metaTemplateId: meta.id ?? undefined,
        metaStatus: meta.status ?? undefined,
        status: nextStatus,
        rejectionReason,
        lastSubmittedAt: new Date(),
        lastSyncedAt: result.response.ok ? new Date() : undefined,
        createdById: actorUserId ?? undefined
      }
    });

    if (!result.response.ok) {
      throw new AppError("Meta template submission failed.", 400, rejectionReason ?? "Meta template submission failed.");
    }

    await messageService.createSendLog({
      action: "contact_template_submit",
      status: nextStatus === "ACCEPTED" ? "sent" : "submitted",
      errorMessage: `${name}/${language}: ${nextStatus}`
    });

    return publicContactTemplate(template);
  },

  async syncContactTemplate(id: string, companyId: string) {
    await assertAutomationSetup();
    const template = await prisma.contactBroadcastTemplate.findFirst({ where: { id, companyId } });
    if (!template) throw new AppError("Template not found.", 404);
    return publicContactTemplate(await syncContactTemplateRecord(template));
  },

  async syncContactTemplates(companyId: string) {
    await assertAutomationSetup();
    const templates = await prisma.contactBroadcastTemplate.findMany({
      where: { companyId },
      orderBy: { updatedAt: "desc" }
    });
    const synced = [];
    for (const template of templates) {
      synced.push(publicContactTemplate(await syncContactTemplateRecord(template)));
    }
    return synced;
  },

  async listContacts(filters: ContactFilters = {}, companyId?: string) {
    await assertAutomationSetup();
    const scopedCompanyId = companyId ?? null;
    const rows = await prisma.$queryRaw<Array<{
      id: string;
      name: string;
      phone: string;
      tags: string[];
      source: string;
      status: string;
      last_contacted: Date | null;
      last_template_name: string | null;
      last_template_content: string | null;
      last_template_status: string | null;
      last_template_at: Date | null;
      templates_sent_count: number | bigint;
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
        (
          SELECT COALESCE(m."rawPayload"->>'templateName', '')
          FROM "Message" m
          WHERE m."leadId" = l.id AND m.direction = 'outbound' AND m.type = 'template'
          ORDER BY m."createdAt" DESC
          LIMIT 1
        ) AS last_template_name,
        (
          SELECT m.content
          FROM "Message" m
          WHERE m."leadId" = l.id AND m.direction = 'outbound' AND m.type = 'template'
          ORDER BY m."createdAt" DESC
          LIMIT 1
        ) AS last_template_content,
        (
          SELECT m.status::text
          FROM "Message" m
          WHERE m."leadId" = l.id AND m.direction = 'outbound' AND m.type = 'template'
          ORDER BY m."createdAt" DESC
          LIMIT 1
        ) AS last_template_status,
        (
          SELECT m."createdAt"
          FROM "Message" m
          WHERE m."leadId" = l.id AND m.direction = 'outbound' AND m.type = 'template'
          ORDER BY m."createdAt" DESC
          LIMIT 1
        ) AS last_template_at,
        (
          SELECT COUNT(*)::bigint
          FROM "Message" m
          WHERE m."leadId" = l.id AND m.direction = 'outbound' AND m.type = 'template'
        ) AS templates_sent_count,
        l."updatedAt" AS updated_at
      FROM "Lead" l
      WHERE (${scopedCompanyId}::text IS NULL OR l."companyId" = ${scopedCompanyId})
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
        templatesSentCount: Number(lead.templates_sent_count ?? 0),
        lastTemplate: lead.last_template_name || lead.last_template_content ? {
          name: lead.last_template_name || null,
          content: lead.last_template_content,
          status: lead.last_template_status?.toUpperCase() ?? null,
          sentAt: lead.last_template_at
        } : null,
        updatedAt: lead.updated_at
      })),
      facets: {
        tags: uniqueTags(rows.flatMap((lead) => lead.tags ?? [])).sort(),
        sources: [...new Set(rows.map((lead) => lead.source).filter(Boolean))].sort(),
        statuses: Object.values(LeadStatus)
      }
    };
  },

  async createContact(input: { name: string; phone: string; tags?: string[]; source?: string }, companyId: string) {
    await assertAutomationSetup();
    const phone = normalizePhoneNumber(input.phone);
    if (!phone) throw new AppError("Enter a valid WhatsApp phone number", 400);

    const tags = uniqueTags(input.tags ?? []);
    const lead = await prisma.lead.upsert({
      where: { companyId_phone: { companyId, phone } },
      create: {
        companyId,
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

  async importContactsFromCsv(input: { csvText: string; source?: string; defaultTags?: string[] }, companyId: string) {
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
    const leadIds: string[] = [];

    for (const row of dataRows) {
      const phone = normalizePhoneNumber(row[phoneIndex] ?? "");
      if (!phone) {
        skipped += 1;
        continue;
      }

      const tags = uniqueTags([...tagsFromValue(row[tagIndex]), ...(input.defaultTags ?? [])]);
      const lead = await prisma.lead.upsert({
        where: { companyId_phone: { companyId, phone } },
        create: {
          companyId,
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
      leadIds.push(lead.id);
      imported += 1;
    }

    logger.info({ imported, skipped }, "Contacts imported from CSV");
    void apiUsageService.log({
      companyId,
      provider: "INTERNAL",
      endpoint: "contacts.import_csv",
      method: "POST",
      statusCode: 200,
      success: true,
      requestUnits: imported,
      metadata: { skipped }
    });
    await messageService.createSendLog({ action: "contacts_csv_import", status: "sent", errorMessage: `Imported ${imported}; skipped ${skipped}` });
    return { imported, skipped, leadIds };
  },

  async importContactsFromGoogleSheets(companyId?: string) {
    await assertAutomationSetup();
    const result = await importLeadsJob(companyId);
    logger.info(result, "Contacts imported from Google Sheets");
    return result;
  },

  async listBulkJobs(companyId?: string) {
    await assertAutomationSetup();
    const jobs = await prisma.bulkMessageJob.findMany({
      where: companyId ? { companyId } : {},
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

  async createBulkSend(input: { name: string; templateName: string; templateLanguage?: string; audience: AudienceFilter }, companyId: string) {
    await assertAutomationSetup();
    const whatsApp = await companyIntegrationService.whatsApp(companyId);
    const templateName = input.templateName || whatsApp.templateName || "";
    const templateLanguage = input.templateLanguage || whatsApp.templateLanguage || "en_US";
    await ensureAcceptedContactTemplate(companyId, templateName, templateLanguage);
    const leads = await selectAudience(input.audience, companyId);
    if (!leads.length) throw new AppError("No contacts matched this bulk-send audience", 400);

    const job = await prisma.bulkMessageJob.create({
      data: {
        name: input.name,
        companyId,
        templateName,
        templateLanguage,
        totalCount: leads.length,
        recipients: {
          create: leads.map((lead) => ({
            leadId: lead.id,
            phone: lead.phone
          }))
        }
      }
    });

    logger.info({ jobId: job.id, count: leads.length, templateName }, "bulk send started");
    void apiUsageService.log({
      companyId,
      provider: "INTERNAL",
      endpoint: "bulk_message_job.create",
      method: "POST",
      statusCode: 202,
      success: true,
      requestUnits: leads.length,
      metadata: { jobId: job.id, templateName, sendGapMs: CONTACT_BROADCAST_SEND_DELAY_MS }
    });
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
            companyId: job.companyId,
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

        await delay(CONTACT_BROADCAST_SEND_DELAY_MS);
      }

      await refreshBulkJobCounts(jobId);
    } catch (error) {
      logger.error({ error, jobId }, "Bulk send worker failed");
      await prisma.bulkMessageJob.update({ where: { id: jobId }, data: { status: BulkJobStatus.FAILED } }).catch(() => null);
    } finally {
      activeBulkJobs.delete(jobId);
    }
  },

  async listCampaigns(companyId?: string) {
    await assertAutomationSetup();
    const campaigns = await prisma.campaign.findMany({
      where: companyId ? { companyId } : {},
      orderBy: { createdAt: "desc" },
      include: { recipients: { include: { lead: true } } }
    });
    return campaigns.map(campaignSummary);
  },

  async campaignDetail(id: string, companyId?: string) {
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

    if (!campaign || (companyId && campaign.companyId !== companyId)) throw new AppError("Campaign not found", 404);

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
  }, companyId: string) {
    await assertAutomationSetup();
    const whatsApp = await companyIntegrationService.whatsApp(companyId);
    const leads = await selectAudience(input.audience, companyId);
    if (!leads.length) throw new AppError("No contacts matched this campaign audience", 400);

    const status = input.scheduleNow
      ? CampaignStatus.RUNNING
      : input.scheduledAt
        ? CampaignStatus.SCHEDULED
        : CampaignStatus.DRAFT;

    const campaign = await prisma.campaign.create({
      data: {
        name: input.name,
        companyId,
        type: CampaignType.WHATSAPP_TEMPLATE,
        audience: input.audience as Prisma.InputJsonObject,
        templateName: input.templateName || whatsApp.templateName || "",
        templateLanguage: input.templateLanguage || whatsApp.templateLanguage,
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
    void apiUsageService.log({
      companyId,
      provider: "INTERNAL",
      endpoint: "campaign.create",
      method: "POST",
      statusCode: 201,
      success: true,
      requestUnits: leads.length,
      metadata: { campaignId: campaign.id, status }
    });
    if (input.scheduleNow) void this.processCampaign(campaign.id);
    return campaign;
  },

  async pauseCampaign(id: string, companyId?: string) {
    await assertAutomationSetup();
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign || (companyId && campaign.companyId !== companyId)) throw new AppError("Campaign not found", 404);
    if (!( [CampaignStatus.SCHEDULED, CampaignStatus.RUNNING] as CampaignStatus[] ).includes(campaign.status)) {
      throw new AppError("Only scheduled or running campaigns can be paused", 400);
    }
    return prisma.campaign.update({ where: { id }, data: { status: CampaignStatus.PAUSED } });
  },

  async resumeCampaign(id: string, companyId?: string) {
    await assertAutomationSetup();
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign || (companyId && campaign.companyId !== companyId)) throw new AppError("Campaign not found", 404);
    if (campaign.status !== CampaignStatus.PAUSED) throw new AppError("Only paused campaigns can be resumed", 400);
    const status = campaign.scheduledAt && campaign.scheduledAt.getTime() > Date.now() ? CampaignStatus.SCHEDULED : CampaignStatus.RUNNING;
    const updated = await prisma.campaign.update({ where: { id }, data: { status } });
    if (status === CampaignStatus.RUNNING) void this.processCampaign(id);
    return updated;
  },

  async cancelCampaign(id: string, companyId?: string) {
    await assertAutomationSetup();
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign || (companyId && campaign.companyId !== companyId)) throw new AppError("Campaign not found", 404);
    if (!( [CampaignStatus.SCHEDULED, CampaignStatus.PAUSED, CampaignStatus.RUNNING] as CampaignStatus[] ).includes(campaign.status)) {
      throw new AppError("Only pending campaigns can be cancelled", 400);
    }
    return prisma.campaign.update({ where: { id }, data: { status: CampaignStatus.CANCELLED } });
  },

  async deleteCampaign(id: string, companyId?: string) {
    await assertAutomationSetup();
    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign || (companyId && campaign.companyId !== companyId)) throw new AppError("Campaign not found", 404);
    await prisma.campaign.delete({ where: { id } });
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
      void apiUsageService.log({
        companyId: campaign.companyId,
        provider: "INTERNAL",
        endpoint: "campaign.execute",
        method: "POST",
        statusCode: 200,
        success: true,
        requestUnits: campaign.recipients.length,
        metadata: { campaignId }
      });

      for (const recipient of campaign.recipients) {
        const current = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
        if (!current || ( [CampaignStatus.PAUSED, CampaignStatus.CANCELLED] as CampaignStatus[] ).includes(current.status)) break;

        try {
          const whatsappMessageId = await sendTemplateToLead({
            leadId: recipient.leadId,
            companyId: campaign.companyId,
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

  async listAdDrafts(companyId?: string) {
    await assertAutomationSetup();
    const drafts = await prisma.adDraft.findMany({ where: companyId ? { companyId } : {}, orderBy: { createdAt: "desc" } });
    const integration = await companyIntegrationService.userStatus(companyId);
    return {
      metaConnected: Boolean(integration.connected.metaAds),
      drafts
    };
  },

  async metaAdsStatus(companyId?: string | null) {
    let credentials;
    try {
      credentials = await companyIntegrationService.metaAds(companyId);
    } catch (error) {
      return {
        connected: false,
        adAccountId: null,
        accountName: null,
        accountStatus: null,
        currency: null,
        timezone: null,
        error: error instanceof Error ? error.message : "Meta Ads not connected for your company."
      };
    }
    const adAccountId = credentials.adAccountId.trim();
    const accessToken = credentials.accessToken.trim();
    const normalizedAccountId = adAccountId.startsWith("act_") ? adAccountId : adAccountId ? `act_${adAccountId}` : "";

    if (!normalizedAccountId || !accessToken) {
      return {
        connected: false,
        adAccountId,
        accountName: null,
        accountStatus: null,
        currency: null,
        timezone: null,
        error: "Meta Ads not connected for your company."
      };
    }

    try {
      const apiVersion = env.WHATSAPP_API_VERSION || "v20.0";
      const url = new URL(`https://graph.facebook.com/${apiVersion}/${normalizedAccountId}`);
      url.searchParams.set("fields", "name,account_status,currency,timezone_name");
      url.searchParams.set("access_token", accessToken);

      const response = await fetch(url);
      const data = (await response.json().catch(() => ({}))) as {
        name?: string;
        account_status?: number | string;
        currency?: string;
        timezone_name?: string;
        error?: { message?: string; code?: number; type?: string };
      };
      void apiUsageService.log({
        companyId,
        provider: "META_ADS",
        endpoint: `/${normalizedAccountId}`,
        method: "GET",
        statusCode: response.status,
        success: response.ok,
        metadata: { fields: "name,account_status,currency,timezone_name", accountId: adAccountId }
      });

      if (!response.ok) {
        return {
          connected: false,
          adAccountId,
          accountName: null,
          accountStatus: null,
          currency: null,
          timezone: null,
          error: data.error?.message || `Meta Ads API returned HTTP ${response.status}.`
        };
      }

      return {
        connected: true,
        adAccountId,
        accountName: data.name || null,
        accountStatus: data.account_status ?? null,
        currency: data.currency || null,
        timezone: data.timezone_name || null,
        error: null
      };
    } catch (error) {
      logger.error({ error, adAccountId }, "Meta Ads status check failed");
      return {
        connected: false,
        adAccountId,
        accountName: null,
        accountStatus: null,
        currency: null,
        timezone: null,
        error: error instanceof Error ? error.message : "Meta Ads API verification failed."
      };
    }
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
  }, companyId: string) {
    await assertAutomationSetup();
    return prisma.adDraft.create({ data: { ...input, companyId } });
  },

  async deleteAdDraft(id: string, companyId?: string) {
    await assertAutomationSetup();
    const draft = await prisma.adDraft.findUnique({ where: { id } });
    if (!draft || (companyId && draft.companyId !== companyId)) throw new AppError("Ad draft not found", 404);
    await prisma.adDraft.delete({ where: { id } });
  },

  async listWorkflows(companyId?: string) {
    await assertAutomationSetup();
    return prisma.aiWorkflow.findMany({
      where: companyId ? { companyId } : {},
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
  }, companyId: string) {
    await assertAutomationSetup();
    if (input.isActive) {
      await companyIntegrationService.assertConnected(companyId, "AI_MODEL", "AI model is not connected for this company.");
    }
    const workflow = await prisma.aiWorkflow.create({
      data: {
        companyId,
        name: input.name,
        triggerType: WorkflowTriggerType[input.triggerType],
        triggerValue: input.triggerValue,
        isActive: Boolean(input.isActive),
        definition: input.definition as Prisma.InputJsonObject
      }
    });
    void apiUsageService.log({
      companyId,
      provider: "INTERNAL",
      endpoint: "ai_workflow.create",
      method: "POST",
      statusCode: 201,
      success: true,
      metadata: { workflowId: workflow.id }
    });
    return workflow;
  },

  async updateWorkflow(id: string, input: Partial<{
    name: string;
    triggerType: keyof typeof WorkflowTriggerType;
    triggerValue: string;
    isActive: boolean;
    definition: WorkflowDefinition;
  }>, companyId?: string) {
    await assertAutomationSetup();
    if (companyId) {
      const existing = await prisma.aiWorkflow.findFirst({ where: { id, companyId }, select: { id: true } });
      if (!existing) throw new AppError("Workflow not found", 404);
      if (input.isActive) {
        await companyIntegrationService.assertConnected(companyId, "AI_MODEL", "AI model is not connected for this company.");
      }
    }
    const workflow = await prisma.aiWorkflow.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.triggerType !== undefined ? { triggerType: WorkflowTriggerType[input.triggerType] } : {}),
        ...(input.triggerValue !== undefined ? { triggerValue: input.triggerValue } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.definition !== undefined ? { definition: input.definition as Prisma.InputJsonObject } : {})
      }
    });
    void apiUsageService.log({
      companyId: workflow.companyId,
      provider: "INTERNAL",
      endpoint: "ai_workflow.update",
      method: "PATCH",
      statusCode: 200,
      success: true,
      metadata: { workflowId: workflow.id }
    });
    return workflow;
  },

  async duplicateWorkflow(id: string, companyId: string) {
    await assertAutomationSetup();
    const existing = await prisma.aiWorkflow.findFirst({ where: { id, companyId } });
    if (!existing) throw new AppError("Workflow not found", 404);
    const workflow = await prisma.aiWorkflow.create({
      data: {
        companyId,
        name: `${existing.name} Copy`,
        triggerType: existing.triggerType,
        triggerValue: existing.triggerValue,
        isActive: false,
        definition: existing.definition as Prisma.InputJsonObject
      }
    });
    void apiUsageService.log({
      companyId,
      provider: "INTERNAL",
      endpoint: "ai_workflow.duplicate",
      method: "POST",
      statusCode: 201,
      success: true,
      metadata: { sourceWorkflowId: id, workflowId: workflow.id }
    });
    return workflow;
  },

  async deleteWorkflow(id: string, companyId?: string) {
    await assertAutomationSetup();
    const existing = await prisma.aiWorkflow.findFirst({ where: { id, ...(companyId ? { companyId } : {}) } });
    if (!existing) throw new AppError("Workflow not found", 404);
    await prisma.aiWorkflow.delete({ where: { id } });
  },

  async executeMatchingWorkflows(input: { leadId: string; phone: string; text: string; source?: string }) {
    const setup = await automationSetupStatus();
    if (!setup.ready) {
      logger.warn(setupRequiredDetails(setup), "AI workflow execution skipped until setup is complete");
      return false;
    }

    const lead = await prisma.lead.findUnique({ where: { id: input.leadId }, select: { companyId: true } });
    if (!lead) return false;
    const workflows = await prisma.aiWorkflow.findMany({ where: { isActive: true, companyId: lead.companyId } });
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
      void apiUsageService.log({
        companyId: lead.companyId,
        provider: "INTERNAL",
        endpoint: "ai_workflow.execute",
        method: "POST",
        statusCode: 202,
        success: true,
        metadata: { workflowId: workflow.id, leadId: input.leadId }
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
        const sent = await whatsappService.sendTextMessage(lead.phone, text, lead.companyId);
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
        const whatsApp = await companyIntegrationService.whatsApp(lead.companyId);
        const templateName = stringConfig(current, "templateName", whatsApp.templateName || "");
        if (!templateName) throw new AppError("Workflow template block needs a template name", 400);
        await sendTemplateToLead({
          leadId,
          companyId: lead.companyId,
          phone: lead.phone,
          customerName: lead.name,
          templateName,
          templateLanguage: stringConfig(current, "templateLanguage", whatsApp.templateLanguage),
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
