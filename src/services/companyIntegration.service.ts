import { IntegrationStatus, IntegrationType, type Integration } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/errors.js";
import { integrationEncryptionKeyConfigured, localIntegrationFallbackEnabled } from "../utils/integrationConfig.js";
import { decryptJson, encryptJson, isSecretField, maskSecret, scrubSecretsFromLogs } from "../utils/secretVault.js";

type VaultConfig = Record<string, string>;
type VaultInput = Record<string, unknown>;

type IntegrationInput = {
  googleSheetsId?: string | null;
  googleServiceAccountEmail?: string | null;
  googlePrivateKey?: string | null;
  whatsappPhoneNumberId?: string | null;
  whatsappBusinessAccountId?: string | null;
  whatsappAccessToken?: string | null;
  whatsappVerifyToken?: string | null;
  whatsappDefaultTemplateName?: string | null;
  whatsappTemplateLanguage?: string | null;
  metaAdAccountId?: string | null;
  metaAdsAccessToken?: string | null;
  facebookPageId?: string | null;
  metaBusinessId?: string | null;
  instagramActorId?: string | null;
  metaPixelId?: string | null;
};

export type GoogleSheetsIntegrationInput = Pick<IntegrationInput, "googleSheetsId" | "googleServiceAccountEmail" | "googlePrivateKey"> | VaultInput;
export type WhatsAppIntegrationInput = Pick<IntegrationInput, "whatsappPhoneNumberId" | "whatsappBusinessAccountId" | "whatsappAccessToken" | "whatsappVerifyToken" | "whatsappDefaultTemplateName" | "whatsappTemplateLanguage"> | VaultInput;
export type MetaAdsIntegrationInput = Pick<IntegrationInput, "metaAdAccountId" | "metaAdsAccessToken" | "facebookPageId" | "metaBusinessId" | "instagramActorId" | "metaPixelId"> | VaultInput;
type IntegrationTestProvider = "googleSheets" | "whatsapp" | "metaAds";
type SecretDebugInput = GoogleSheetsIntegrationInput & WhatsAppIntegrationInput & MetaAdsIntegrationInput;

export type GoogleSheetsCredentials = {
  spreadsheetId: string;
  serviceAccountEmail: string;
  privateKey: string;
};

export type WhatsAppCredentials = {
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  verifyToken: string;
  templateName?: string | null;
  templateLanguage: string;
};

export type MetaAdsCredentials = {
  adAccountId: string;
  accessToken: string;
  facebookPageId: string;
  metaBusinessId?: string | null;
  instagramActorId?: string | null;
  metaPixelId?: string | null;
};

export type AiModelCredentials = {
  provider: "OPENAI" | "ANTHROPIC" | "GEMINI" | "CUSTOM";
  modelName: string;
  apiKey: string;
  baseUrl?: string | null;
};

type FieldDefinition = {
  key: string;
  legacyKey?: string;
  required?: boolean;
  masked?: boolean;
};

const integrationDefinitions: Record<IntegrationType, {
  slug: string;
  label: string;
  description: string;
  fields: FieldDefinition[];
}> = {
  GOOGLE_SHEETS: {
    slug: "google-sheets",
    label: "Google Sheets",
    description: "Connect Google Sheets for lead storage, lead sync, CSV-style audience import, and campaign data.",
    fields: [
      { key: "GOOGLE_SHEETS_ID", legacyKey: "googleSheetsId", required: true, masked: true },
      { key: "GOOGLE_SERVICE_ACCOUNT_EMAIL", legacyKey: "googleServiceAccountEmail", required: true },
      { key: "GOOGLE_PRIVATE_KEY", legacyKey: "googlePrivateKey", required: true, masked: true }
    ]
  },
  WHATSAPP_CLOUD: {
    slug: "whatsapp-cloud",
    label: "WhatsApp Cloud API",
    description: "Connect Meta WhatsApp Cloud API for inbox, manual replies, broadcast, campaigns, templates, and webhook events.",
    fields: [
      { key: "WHATSAPP_PHONE_NUMBER_ID", legacyKey: "whatsappPhoneNumberId", required: true, masked: true },
      { key: "WHATSAPP_BUSINESS_ACCOUNT_ID", legacyKey: "whatsappBusinessAccountId", required: true, masked: true },
      { key: "WHATSAPP_ACCESS_TOKEN", legacyKey: "whatsappAccessToken", required: true, masked: true },
      { key: "WHATSAPP_VERIFY_TOKEN", legacyKey: "whatsappVerifyToken", required: true, masked: true }
    ]
  },
  WHATSAPP_TEMPLATE_SETTINGS: {
    slug: "whatsapp-template-settings",
    label: "Broadcast & Campaign Templates",
    description: "Set the default approved WhatsApp template used for broadcasts and campaigns.",
    fields: [
      { key: "WHATSAPP_TEMPLATE_NAME", legacyKey: "whatsappDefaultTemplateName", required: true },
      { key: "WHATSAPP_TEMPLATE_LANGUAGE", legacyKey: "whatsappTemplateLanguage", required: true }
    ]
  },
  META_ADS: {
    slug: "meta-ads",
    label: "Meta Ads",
    description: "Connect Meta Ads to create, publish, track, and optimize Click-to-WhatsApp campaigns for this company.",
    fields: [
      { key: "META_ADS_ACCESS_TOKEN", legacyKey: "metaAdsAccessToken", required: true, masked: true },
      { key: "META_AD_ACCOUNT_ID", legacyKey: "metaAdAccountId", required: true, masked: true },
      { key: "FACEBOOK_PAGE_ID", legacyKey: "facebookPageId", required: true, masked: true },
      { key: "META_BUSINESS_ID", legacyKey: "metaBusinessId", required: false, masked: true },
      { key: "INSTAGRAM_ACTOR_ID", legacyKey: "instagramActorId", required: false, masked: true },
      { key: "META_PIXEL_ID", legacyKey: "metaPixelId", required: false, masked: true }
    ]
  },
  KNOWLEDGE_BASE: {
    slug: "knowledge-base",
    label: "Knowledge Base",
    description: "Upload company knowledge or connect a company website so the AI agent can answer using RAG.",
    fields: [
      { key: "websiteUrl", required: false },
      { key: "documentName", required: false },
      { key: "documentType", required: false }
    ]
  },
  AI_MODEL: {
    slug: "ai-model",
    label: "AI Model for Messaging",
    description: "Connect the AI model used for AI replies, AI workflow builder, lead qualification, and RAG answers.",
    fields: [
      { key: "AI_PROVIDER", required: true },
      { key: "AI_MODEL_NAME", required: true },
      { key: "AI_API_KEY", required: true, masked: true },
      { key: "AI_BASE_URL", required: false }
    ]
  }
};

const typeAliases: Record<string, IntegrationType> = {
  googleSheets: IntegrationType.GOOGLE_SHEETS,
  "google-sheets": IntegrationType.GOOGLE_SHEETS,
  GOOGLE_SHEETS: IntegrationType.GOOGLE_SHEETS,
  whatsapp: IntegrationType.WHATSAPP_CLOUD,
  whatsApp: IntegrationType.WHATSAPP_CLOUD,
  "whatsapp-cloud": IntegrationType.WHATSAPP_CLOUD,
  WHATSAPP_CLOUD: IntegrationType.WHATSAPP_CLOUD,
  "whatsapp-template-settings": IntegrationType.WHATSAPP_TEMPLATE_SETTINGS,
  whatsappTemplateSettings: IntegrationType.WHATSAPP_TEMPLATE_SETTINGS,
  WHATSAPP_TEMPLATE_SETTINGS: IntegrationType.WHATSAPP_TEMPLATE_SETTINGS,
  metaAds: IntegrationType.META_ADS,
  "meta-ads": IntegrationType.META_ADS,
  META_ADS: IntegrationType.META_ADS,
  "knowledge-base": IntegrationType.KNOWLEDGE_BASE,
  knowledgeBase: IntegrationType.KNOWLEDGE_BASE,
  KNOWLEDGE_BASE: IntegrationType.KNOWLEDGE_BASE,
  "ai-model": IntegrationType.AI_MODEL,
  aiModel: IntegrationType.AI_MODEL,
  AI_MODEL: IntegrationType.AI_MODEL
};

const requiredErrors: Record<string, string> = {
  GOOGLE_SHEETS_ID: "GOOGLE_SHEETS_ID wrong",
  GOOGLE_SERVICE_ACCOUNT_EMAIL: "GOOGLE_SERVICE_ACCOUNT_EMAIL wrong",
  GOOGLE_PRIVATE_KEY: "GOOGLE_PRIVATE_KEY wrong",
  WHATSAPP_PHONE_NUMBER_ID: "WHATSAPP_PHONE_NUMBER_ID wrong",
  WHATSAPP_BUSINESS_ACCOUNT_ID: "WHATSAPP_BUSINESS_ACCOUNT_ID wrong",
  WHATSAPP_ACCESS_TOKEN: "WHATSAPP_ACCESS_TOKEN wrong",
  WHATSAPP_VERIFY_TOKEN: "WHATSAPP_VERIFY_TOKEN wrong",
  WHATSAPP_TEMPLATE_NAME: "WHATSAPP_TEMPLATE_NAME wrong",
  WHATSAPP_TEMPLATE_LANGUAGE: "WHATSAPP_TEMPLATE_LANGUAGE wrong",
  META_ADS_ACCESS_TOKEN: "META_ADS_ACCESS_TOKEN wrong",
  META_AD_ACCOUNT_ID: "META_AD_ACCOUNT_ID wrong",
  FACEBOOK_PAGE_ID: "FACEBOOK_PAGE_ID wrong",
  META_BUSINESS_ID: "META_BUSINESS_ID wrong",
  INSTAGRAM_ACTOR_ID: "INSTAGRAM_ACTOR_ID wrong",
  META_PIXEL_ID: "META_PIXEL_ID wrong",
  AI_PROVIDER: "AI_PROVIDER wrong",
  AI_MODEL_NAME: "AI_MODEL_NAME wrong",
  AI_API_KEY: "AI_API_KEY wrong",
  AI_BASE_URL: "AI_BASE_URL wrong"
};

const allTypes = Object.values(IntegrationType) as IntegrationType[];

function clean(value?: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

function normalizeGooglePrivateKey(value: string) {
  return value.trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n").trim();
}

function asJsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeIntegrationType(value: string) {
  const type = typeAliases[value];
  if (!type) throw new AppError("Unknown integration type.", 400);
  return type;
}

function definition(type: IntegrationType) {
  return integrationDefinitions[type];
}

const notConnectedMessages: Record<IntegrationType, string> = {
  GOOGLE_SHEETS: "Google Sheets integration is not connected for this company.",
  WHATSAPP_CLOUD: "WhatsApp Cloud API is not connected for this company.",
  WHATSAPP_TEMPLATE_SETTINGS: "WhatsApp template settings are not configured for this company.",
  META_ADS: "Connect Meta Ads integration to publish.",
  KNOWLEDGE_BASE: "Knowledge base is not indexed for this company.",
  AI_MODEL: "AI model is not connected for this company."
};

function integrationNotConnected(type: IntegrationType, message?: string) {
  return new AppError(message ?? notConnectedMessages[type], 400, {
    code: "INTEGRATION_NOT_CONNECTED",
    integrationType: type
  });
}

function normalizeInputForType(type: IntegrationType, input: VaultInput = {}) {
  const normalized: VaultConfig = {};
  const def = definition(type);

  for (const field of def.fields) {
    const rawValue = input[field.key] ?? (field.legacyKey ? input[field.legacyKey] : undefined);
    const value = field.key === "GOOGLE_PRIVATE_KEY" && clean(rawValue)
      ? normalizeGooglePrivateKey(clean(rawValue)!)
      : clean(rawValue);
    if (value) normalized[field.key] = value;
  }

  if (type === IntegrationType.AI_MODEL && !normalized.AI_PROVIDER && clean(input.aiProvider)) {
    normalized.AI_PROVIDER = clean(input.aiProvider)!.toUpperCase();
  }

  if (type === IntegrationType.KNOWLEDGE_BASE) {
    if (clean(input.companyWebsiteUrl)) normalized.websiteUrl = clean(input.companyWebsiteUrl)!;
    if (clean(input.websiteUrl)) normalized.websiteUrl = clean(input.websiteUrl)!;
  }

  return normalized;
}

function readConfig(row?: Pick<Integration, "encryptedConfig"> | null): VaultConfig {
  if (!row?.encryptedConfig) return {};

  try {
    const decrypted = decryptJson(row.encryptedConfig);
    return Object.fromEntries(
      Object.entries(decrypted)
        .map(([key, value]) => [key, clean(value)])
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
    );
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : "Saved secret cannot be decrypted.", 400);
  }
}

function encryptConfig(config: VaultConfig) {
  const filtered = Object.fromEntries(
    Object.entries(config).filter(([_key, value]) => Boolean(clean(value)))
  );

  try {
    return Object.keys(filtered).length ? encryptJson(filtered) : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new AppError(/encryption key/i.test(message) ? "Server encryption is not configured." : "Credential encryption failed.", 500);
  }
}

function maskField(type: IntegrationType, field: FieldDefinition, value?: string | null) {
  if (!value) return null;
  if (type === IntegrationType.META_ADS && field.key === "META_AD_ACCOUNT_ID") {
    const normalized = value.startsWith("act_") ? value : `act_${value}`;
    const suffix = normalized.replace(/^act_/, "");
    return `act_${maskSecret(suffix)}`;
  }

  if (field.masked || isSecretField(field.key)) {
    return field.key === "GOOGLE_PRIVATE_KEY" ? maskSecret(value, 3) : maskSecret(value);
  }

  return value;
}

function maskedDisplay(type: IntegrationType, config: VaultConfig) {
  const def = definition(type);
  return Object.fromEntries(
    def.fields
      .map((field) => [field.key, maskField(type, field, config[field.key])])
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
}

function publicIntegration(type: IntegrationType, row?: Integration | null) {
  const def = definition(type);
  const display = asJsonObject(row?.maskedDisplay);
  return {
    id: row?.id ?? null,
    type,
    slug: def.slug,
    label: def.label,
    description: def.description,
    status: row?.status ?? IntegrationStatus.NOT_CONNECTED,
    maskedDisplay: display,
    fieldState: Object.fromEntries(def.fields.map((field) => [
      field.key,
      {
        exists: Boolean(display[field.key]),
        maskedValue: display[field.key] ?? null,
        secret: Boolean(field.masked || isSecretField(field.key))
      }
    ])),
    metadata: scrubSecretsFromLogs(asJsonObject(row?.metadata)),
    lastVerifiedAt: row?.lastVerifiedAt ?? null,
    lastVerificationError: row?.lastVerificationError ?? null,
    updatedAt: row?.updatedAt ?? null
  };
}

async function rowForIntegration(companyId: string | null | undefined, type: IntegrationType) {
  if (!companyId) return null;
  return prisma.integration.findUnique({ where: { companyId_type: { companyId, type } } });
}

async function assertCompany(companyId: string) {
  await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { id: true } });
}

async function auditIntegration(input: {
  companyId: string;
  integrationId?: string | null;
  type: IntegrationType;
  action: string;
  actorUserId?: string | null;
  status?: IntegrationStatus | null;
  metadata?: Record<string, unknown>;
}) {
  await prisma.integrationAudit.create({
    data: {
      companyId: input.companyId,
      integrationId: input.integrationId ?? null,
      type: input.type,
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      status: input.status ?? null,
      metadata: scrubSecretsFromLogs(input.metadata ?? {}) as object
    }
  }).catch(() => null);
}

function requireFields(type: IntegrationType, config: VaultConfig) {
  const def = definition(type);
  for (const field of def.fields) {
    if (!field.required) continue;
    if (field.key === "AI_BASE_URL" && config.AI_PROVIDER !== "CUSTOM") continue;
    if (type === IntegrationType.AI_MODEL && field.key === "AI_MODEL_NAME" && config.AI_PROVIDER === "ANTHROPIC") continue;
    if (!clean(config[field.key])) {
      throw new AppError(requiredErrors[field.key] ?? `${field.key} wrong`, 400);
    }
  }
}

function envGoogleFallback(): GoogleSheetsCredentials | null {
  if (!env.GOOGLE_SHEETS_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) return null;
  return {
    spreadsheetId: env.GOOGLE_SHEETS_ID,
    serviceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_PRIVATE_KEY
  };
}

function envWhatsAppFallback(): WhatsAppCredentials | null {
  if (!env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_BUSINESS_ACCOUNT_ID || !env.WHATSAPP_VERIFY_TOKEN) return null;
  return {
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    templateName: env.WHATSAPP_TEMPLATE_NAME ?? null,
    templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE
  };
}

function envMetaFallback(): MetaAdsCredentials | null {
  if (!env.META_AD_ACCOUNT_ID || !env.META_ADS_ACCESS_TOKEN || !env.FACEBOOK_PAGE_ID) return null;
  return {
    adAccountId: env.META_AD_ACCOUNT_ID,
    accessToken: env.META_ADS_ACCESS_TOKEN,
    facebookPageId: env.FACEBOOK_PAGE_ID,
    metaBusinessId: env.META_BUSINESS_ID ?? null,
    instagramActorId: env.INSTAGRAM_ACTOR_ID ?? null,
    metaPixelId: env.META_PIXEL_ID ?? null
  };
}

function envAiFallback(): AiModelCredentials | null {
  if (!env.ANTHROPIC_API_KEY || !env.CLAUDE_MODEL) return null;
  return {
    provider: "ANTHROPIC",
    modelName: env.CLAUDE_MODEL,
    apiKey: env.ANTHROPIC_API_KEY,
    baseUrl: null
  };
}

async function resolveVaultConfig(type: IntegrationType, companyId?: string | null, input?: VaultInput, options: { requireConnected?: boolean } = {}) {
  const row = await rowForIntegration(companyId, type);
  const saved = readConfig(row);
  const submitted = normalizeInputForType(type, input ?? {});
  const config = { ...saved, ...submitted };

  if (options.requireConnected && row?.status !== IntegrationStatus.CONNECTED) {
    throw integrationNotConnected(type);
  }

  requireFields(type, config);
  return { row, config };
}

function statusValue(row?: Integration | null) {
  return row?.status ?? IntegrationStatus.NOT_CONNECTED;
}

function knowledgeStatus(row?: Integration | null) {
  const metadata = asJsonObject(row?.metadata);
  return String(metadata.indexStatus || statusValue(row));
}

function legacyConnected(entries: Record<IntegrationType, Integration | null>) {
  return {
    googleSheets: entries.GOOGLE_SHEETS?.status === IntegrationStatus.CONNECTED,
    whatsapp: entries.WHATSAPP_CLOUD?.status === IntegrationStatus.CONNECTED,
    metaAds: entries.META_ADS?.status === IntegrationStatus.CONNECTED,
    aiModel: entries.AI_MODEL?.status === IntegrationStatus.CONNECTED,
    knowledgeBase: entries.KNOWLEDGE_BASE?.status === IntegrationStatus.CONNECTED
  };
}

export const companyIntegrationService = {
  normalizeType: normalizeIntegrationType,
  definitions: integrationDefinitions,

  async listIntegrationCompanyCards() {
    const companies = await prisma.company.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        users: {
          where: { role: "USER" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            id: true,
            username: true,
            email: true,
            lastLoginAt: true
          }
        },
        integrations: {
          select: {
            type: true,
            status: true
          }
        }
      }
    });

    return companies.map((company) => {
      const connectedCount = company.integrations.filter((integration) => integration.status === IntegrationStatus.CONNECTED).length;
      const errorCount = company.integrations.filter((integration) => (
        integration.status === IntegrationStatus.ERROR ||
        integration.status === IntegrationStatus.PARTIALLY_CONNECTED
      )).length;
      const owner = company.users[0] ?? null;

      return {
        id: company.id,
        name: company.name,
        slug: company.slug,
        status: company.status,
        plan: "Starter",
        owner: owner
          ? {
              username: owner.username,
              email: owner.email,
              lastLoginAt: owner.lastLoginAt
            }
          : null,
        connectedIntegrationCount: connectedCount,
        errorIntegrationCount: errorCount,
        totalIntegrationCount: allTypes.length
      };
    });
  },

  async listCompanyIntegrations(companyId: string) {
    await assertCompany(companyId);
    const rows = await prisma.integration.findMany({ where: { companyId } });
    const byType = new Map(rows.map((row) => [row.type, row]));
    return allTypes.map((type) => publicIntegration(type, byType.get(type)));
  },

  async getCompanyIntegration(companyId: string, typeValue: string) {
    const type = normalizeIntegrationType(typeValue);
    await assertCompany(companyId);
    return publicIntegration(type, await rowForIntegration(companyId, type));
  },

  async saveIntegration(companyId: string, typeValue: string, input: VaultInput = {}, actorUserId?: string | null) {
    const type = normalizeIntegrationType(typeValue);
    await assertCompany(companyId);
    const existing = await rowForIntegration(companyId, type);
    const saved = readConfig(existing);
    const submitted = normalizeInputForType(type, input);
    const nextConfig = { ...saved, ...submitted };
    const changed = Object.keys(submitted).length > 0;
    const nextMaskedDisplay = maskedDisplay(type, nextConfig);
    const encryptedConfig = encryptConfig(nextConfig);
    const nextStatus = changed
      ? IntegrationStatus.PARTIALLY_CONNECTED
      : existing?.status ?? IntegrationStatus.NOT_CONNECTED;

    const row = await prisma.integration.upsert({
      where: { companyId_type: { companyId, type } },
      create: {
        companyId,
        type,
        status: encryptedConfig ? nextStatus : IntegrationStatus.NOT_CONNECTED,
        encryptedConfig,
        maskedDisplay: nextMaskedDisplay,
        metadata: {},
        createdById: actorUserId ?? null,
        updatedById: actorUserId ?? null
      },
      update: {
        status: encryptedConfig ? nextStatus : IntegrationStatus.NOT_CONNECTED,
        encryptedConfig,
        maskedDisplay: nextMaskedDisplay,
        updatedById: actorUserId ?? null
      }
    });

    await auditIntegration({
      companyId,
      integrationId: row.id,
      type,
      action: "integration.updated",
      actorUserId,
      status: row.status,
      metadata: { fields: Object.keys(submitted) }
    });

    return publicIntegration(type, row);
  },

  async updateVerificationResult(companyId: string, typeValue: string, result: {
    status: IntegrationStatus;
    message: string;
    metadata?: Record<string, unknown>;
  }, actorUserId?: string | null, action = "integration.verified") {
    const type = normalizeIntegrationType(typeValue);
    await assertCompany(companyId);
    const existing = await rowForIntegration(companyId, type);
    const saved = readConfig(existing);
    const row = await prisma.integration.upsert({
      where: { companyId_type: { companyId, type } },
      create: {
        companyId,
        type,
        status: result.status,
        encryptedConfig: encryptConfig(saved),
        maskedDisplay: maskedDisplay(type, saved),
        metadata: scrubSecretsFromLogs(result.metadata ?? {}) as object,
        lastVerifiedAt: result.status === IntegrationStatus.CONNECTED ? new Date() : null,
        lastVerificationError: result.status === IntegrationStatus.CONNECTED ? null : result.message,
        createdById: actorUserId ?? null,
        updatedById: actorUserId ?? null
      },
      update: {
        status: result.status,
        metadata: scrubSecretsFromLogs(result.metadata ?? {}) as object,
        lastVerifiedAt: result.status === IntegrationStatus.CONNECTED ? new Date() : existing?.lastVerifiedAt ?? null,
        lastVerificationError: result.status === IntegrationStatus.CONNECTED ? null : result.message,
        updatedById: actorUserId ?? null
      }
    });

    await auditIntegration({
      companyId,
      integrationId: row.id,
      type,
      action,
      actorUserId,
      status: row.status,
      metadata: { message: result.message, ...(result.metadata ?? {}) }
    });

    return publicIntegration(type, row);
  },

  async recordAudit(input: {
    companyId: string;
    typeValue: string;
    action: string;
    actorUserId?: string | null;
    status?: IntegrationStatus | null;
    metadata?: Record<string, unknown>;
  }) {
    const type = normalizeIntegrationType(input.typeValue);
    const row = await rowForIntegration(input.companyId, type);
    await auditIntegration({
      companyId: input.companyId,
      integrationId: row?.id ?? null,
      type,
      action: input.action,
      actorUserId: input.actorUserId,
      status: input.status ?? row?.status ?? null,
      metadata: input.metadata
    });
  },

  async disconnectIntegration(companyId: string, typeValue: string, actorUserId?: string | null) {
    const type = normalizeIntegrationType(typeValue);
    await assertCompany(companyId);
    const row = await prisma.integration.upsert({
      where: { companyId_type: { companyId, type } },
      create: {
        companyId,
        type,
        status: IntegrationStatus.NOT_CONNECTED,
        encryptedConfig: null,
        maskedDisplay: {},
        metadata: {},
        createdById: actorUserId ?? null,
        updatedById: actorUserId ?? null
      },
      update: {
        status: IntegrationStatus.NOT_CONNECTED,
        encryptedConfig: null,
        maskedDisplay: {},
        metadata: {},
        lastVerifiedAt: null,
        lastVerificationError: null,
        updatedById: actorUserId ?? null
      }
    });

    await auditIntegration({
      companyId,
      integrationId: row.id,
      type,
      action: "integration.disconnected",
      actorUserId,
      status: IntegrationStatus.NOT_CONNECTED
    });

    return publicIntegration(type, row);
  },

  async resolveConfigForVerification(companyId: string, typeValue: string, input?: VaultInput) {
    const type = normalizeIntegrationType(typeValue);
    await assertCompany(companyId);
    return resolveVaultConfig(type, companyId, input, { requireConnected: false });
  },

  async assertConnected(companyId: string, typeValue: string, message?: string) {
    const type = normalizeIntegrationType(typeValue);
    const row = await rowForIntegration(companyId, type);
    if (row?.status !== IntegrationStatus.CONNECTED) throw integrationNotConnected(type, message);
    return row;
  },

  async listAdmin(companyId?: string | null) {
    if (!companyId) {
      const rows = await prisma.integration.findMany({ orderBy: { updatedAt: "desc" } });
      return rows.map((row) => publicIntegration(row.type, row));
    }

    const rows = await this.listCompanyIntegrations(companyId);
    const entries = Object.fromEntries(rows.map((row) => [row.type, row]));
    return {
      companyId,
      googleSheetsId: entries.GOOGLE_SHEETS?.maskedDisplay?.GOOGLE_SHEETS_ID ?? null,
      googleServiceAccountEmail: entries.GOOGLE_SHEETS?.maskedDisplay?.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
      googlePrivateKeyMasked: entries.GOOGLE_SHEETS?.maskedDisplay?.GOOGLE_PRIVATE_KEY ?? null,
      whatsappPhoneNumberId: entries.WHATSAPP_CLOUD?.maskedDisplay?.WHATSAPP_PHONE_NUMBER_ID ?? null,
      whatsappBusinessAccountId: entries.WHATSAPP_CLOUD?.maskedDisplay?.WHATSAPP_BUSINESS_ACCOUNT_ID ?? null,
      whatsappAccessTokenMasked: entries.WHATSAPP_CLOUD?.maskedDisplay?.WHATSAPP_ACCESS_TOKEN ?? null,
      whatsappVerifyToken: entries.WHATSAPP_CLOUD?.maskedDisplay?.WHATSAPP_VERIFY_TOKEN ?? null,
      whatsappDefaultTemplateName: entries.WHATSAPP_TEMPLATE_SETTINGS?.maskedDisplay?.WHATSAPP_TEMPLATE_NAME ?? null,
      whatsappTemplateLanguage: entries.WHATSAPP_TEMPLATE_SETTINGS?.maskedDisplay?.WHATSAPP_TEMPLATE_LANGUAGE ?? "en",
      metaAdAccountId: entries.META_ADS?.maskedDisplay?.META_AD_ACCOUNT_ID ?? null,
      metaAdsAccessTokenMasked: entries.META_ADS?.maskedDisplay?.META_ADS_ACCESS_TOKEN ?? null,
      facebookPageId: entries.META_ADS?.maskedDisplay?.FACEBOOK_PAGE_ID ?? null,
      metaBusinessId: entries.META_ADS?.maskedDisplay?.META_BUSINESS_ID ?? null,
      instagramActorId: entries.META_ADS?.maskedDisplay?.INSTAGRAM_ACTOR_ID ?? null,
      metaPixelId: entries.META_ADS?.maskedDisplay?.META_PIXEL_ID ?? null,
      connected: {
        googleSheets: entries.GOOGLE_SHEETS?.status === IntegrationStatus.CONNECTED,
        whatsapp: entries.WHATSAPP_CLOUD?.status === IntegrationStatus.CONNECTED,
        metaAds: entries.META_ADS?.status === IntegrationStatus.CONNECTED
      }
    };
  },

  async updateAdmin(companyId: string, input: IntegrationInput) {
    await this.saveIntegration(companyId, IntegrationType.GOOGLE_SHEETS, input);
    await this.saveIntegration(companyId, IntegrationType.WHATSAPP_CLOUD, input);
    await this.saveIntegration(companyId, IntegrationType.WHATSAPP_TEMPLATE_SETTINGS, input);
    await this.saveIntegration(companyId, IntegrationType.META_ADS, input);
    return this.listAdmin(companyId);
  },

  async clearProvider(companyId: string, provider: "googleSheets" | "whatsapp" | "metaAds") {
    const type = provider === "googleSheets"
      ? IntegrationType.GOOGLE_SHEETS
      : provider === "metaAds"
        ? IntegrationType.META_ADS
        : IntegrationType.WHATSAPP_CLOUD;
    await this.disconnectIntegration(companyId, type);
    return this.listAdmin(companyId);
  },

  async userStatus(companyId?: string | null) {
    if (!companyId) {
      return {
        googleSheets: IntegrationStatus.NOT_CONNECTED,
        whatsappCloud: IntegrationStatus.NOT_CONNECTED,
        whatsappTemplateSettings: IntegrationStatus.NOT_CONNECTED,
        metaAds: IntegrationStatus.NOT_CONNECTED,
        aiModel: IntegrationStatus.NOT_CONNECTED,
        knowledgeBase: IntegrationStatus.NOT_CONNECTED,
        connected: {
          googleSheets: false,
          whatsapp: false,
          metaAds: false,
          aiModel: false,
          knowledgeBase: false
        }
      };
    }

    const rows = await prisma.integration.findMany({ where: { companyId } });
    const entries = Object.fromEntries(allTypes.map((type) => [type, rows.find((row) => row.type === type) ?? null])) as Record<IntegrationType, Integration | null>;

    return {
      googleSheets: statusValue(entries.GOOGLE_SHEETS),
      whatsappCloud: statusValue(entries.WHATSAPP_CLOUD),
      whatsappTemplateSettings: statusValue(entries.WHATSAPP_TEMPLATE_SETTINGS),
      metaAds: statusValue(entries.META_ADS),
      aiModel: statusValue(entries.AI_MODEL),
      knowledgeBase: knowledgeStatus(entries.KNOWLEDGE_BASE),
      connected: legacyConnected(entries)
    };
  },

  async integrationSecretState(provider: IntegrationTestProvider, companyId?: string | null, input?: SecretDebugInput) {
    const type = provider === "googleSheets"
      ? IntegrationType.GOOGLE_SHEETS
      : provider === "metaAds"
        ? IntegrationType.META_ADS
        : IntegrationType.WHATSAPP_CLOUD;
    const row = await rowForIntegration(companyId, type);
    const display = asJsonObject(row?.maskedDisplay);
    const normalized = normalizeInputForType(type, input ?? {});
    const accessKey = provider === "whatsapp" ? "WHATSAPP_ACCESS_TOKEN" : provider === "metaAds" ? "META_ADS_ACCESS_TOKEN" : "";

    return {
      accessTokenProvidedInRequest: accessKey ? Boolean(normalized[accessKey]) : false,
      savedAccessTokenExists: accessKey ? Boolean(display[accessKey]) : false,
      privateKeyProvidedInRequest: provider === "googleSheets" ? Boolean(normalized.GOOGLE_PRIVATE_KEY) : false,
      savedPrivateKeyExists: provider === "googleSheets" ? Boolean(display.GOOGLE_PRIVATE_KEY) : false,
      encryptionKeyConfigured: integrationEncryptionKeyConfigured()
    };
  },

  async googleSheets(companyId?: string | null, input?: GoogleSheetsIntegrationInput) {
    try {
      const { config } = await resolveVaultConfig(IntegrationType.GOOGLE_SHEETS, companyId, input as VaultInput, { requireConnected: !input });
      return {
        spreadsheetId: config.GOOGLE_SHEETS_ID,
        serviceAccountEmail: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        privateKey: config.GOOGLE_PRIVATE_KEY
      };
    } catch (error) {
      if (localIntegrationFallbackEnabled()) {
        const fallback = envGoogleFallback();
        if (fallback) return fallback;
      }
      throw error;
    }
  },

  async whatsApp(companyId?: string | null, input?: WhatsAppIntegrationInput) {
    try {
      const { config } = await resolveVaultConfig(IntegrationType.WHATSAPP_CLOUD, companyId, input as VaultInput, { requireConnected: !input });
      const templateRow = await rowForIntegration(companyId, IntegrationType.WHATSAPP_TEMPLATE_SETTINGS);
      const templateConfig = readConfig(templateRow);
      const submittedTemplate = normalizeInputForType(IntegrationType.WHATSAPP_TEMPLATE_SETTINGS, input as VaultInput ?? {});
      const mergedTemplate = { ...templateConfig, ...submittedTemplate };
      return {
        phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
        businessAccountId: config.WHATSAPP_BUSINESS_ACCOUNT_ID,
        accessToken: config.WHATSAPP_ACCESS_TOKEN,
        verifyToken: config.WHATSAPP_VERIFY_TOKEN,
        templateName: clean(mergedTemplate.WHATSAPP_TEMPLATE_NAME),
        templateLanguage: clean(mergedTemplate.WHATSAPP_TEMPLATE_LANGUAGE) ?? "en_US"
      };
    } catch (error) {
      if (localIntegrationFallbackEnabled()) {
        const fallback = envWhatsAppFallback();
        if (fallback) return fallback;
      }
      throw error;
    }
  },

  async metaAds(companyId?: string | null, input?: MetaAdsIntegrationInput) {
    try {
      const { config } = await resolveVaultConfig(IntegrationType.META_ADS, companyId, input as VaultInput, { requireConnected: !input });
      return {
        adAccountId: config.META_AD_ACCOUNT_ID,
        accessToken: config.META_ADS_ACCESS_TOKEN,
        facebookPageId: config.FACEBOOK_PAGE_ID,
        metaBusinessId: clean(config.META_BUSINESS_ID),
        instagramActorId: clean(config.INSTAGRAM_ACTOR_ID),
        metaPixelId: clean(config.META_PIXEL_ID)
      };
    } catch (error) {
      if (localIntegrationFallbackEnabled()) {
        const fallback = envMetaFallback();
        if (fallback) return fallback;
      }
      throw error;
    }
  },

  async aiModel(companyId?: string | null, input?: VaultInput) {
    try {
      const { config } = await resolveVaultConfig(IntegrationType.AI_MODEL, companyId, input, { requireConnected: !input });
      const provider = clean(config.AI_PROVIDER)?.toUpperCase();
      if (!["OPENAI", "ANTHROPIC", "GEMINI", "CUSTOM"].includes(provider ?? "")) {
        throw new AppError("AI_PROVIDER wrong", 400);
      }

      if (provider === "CUSTOM" && !clean(config.AI_BASE_URL)) {
        throw new AppError("AI_BASE_URL wrong", 400);
      }

      return {
        provider: provider as AiModelCredentials["provider"],
        modelName: clean(config.AI_MODEL_NAME) ?? env.CLAUDE_MODEL,
        apiKey: config.AI_API_KEY,
        baseUrl: clean(config.AI_BASE_URL)
      };
    } catch (error) {
      if (localIntegrationFallbackEnabled()) {
        const fallback = envAiFallback();
        if (fallback) return fallback;
      }
      throw error;
    }
  },

  async findCompanyByWhatsAppPhoneNumberId(phoneNumberId?: string | null) {
    const target = clean(phoneNumberId);
    if (!target) return null;

    const rows = await prisma.integration.findMany({
      where: { type: IntegrationType.WHATSAPP_CLOUD, status: IntegrationStatus.CONNECTED },
      select: { companyId: true, encryptedConfig: true }
    });

    for (const row of rows) {
      const config = readConfig(row);
      if (config.WHATSAPP_PHONE_NUMBER_ID === target) return row.companyId;
    }

    if (localIntegrationFallbackEnabled() && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_PHONE_NUMBER_ID === target) {
      const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
      return company?.id ?? null;
    }

    return null;
  },

  async acceptsWebhookVerifyToken(token?: string | null) {
    const verifyToken = clean(token);
    if (!verifyToken) return false;
    if (localIntegrationFallbackEnabled() && env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_VERIFY_TOKEN === verifyToken) return true;

    const rows = await prisma.integration.findMany({
      where: { type: IntegrationType.WHATSAPP_CLOUD, status: IntegrationStatus.CONNECTED },
      select: { encryptedConfig: true }
    });

    return rows.some((row) => readConfig(row).WHATSAPP_VERIFY_TOKEN === verifyToken);
  }
};
