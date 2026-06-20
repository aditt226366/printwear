import { google } from "googleapis";
import { IntegrationStatus, IntegrationType } from "@prisma/client";
import { z, type ZodTypeAny } from "zod";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { scrubSecretsFromLogs } from "../utils/secretVault.js";
import { apiUsageService } from "./apiUsage.service.js";
import { companyIntegrationService } from "./companyIntegration.service.js";
import { knowledgeIngestionService } from "./knowledgeIngestion.service.js";
import { metaAdsVerificationService } from "./metaAdsVerification.service.js";

type VerificationResult = {
  status: IntegrationStatus;
  message: string;
  metadata?: Record<string, unknown>;
};

type VerifyOptions = {
  input?: Record<string, unknown>;
  file?: Express.Multer.File;
  actorUserId?: string | null;
  persist?: boolean;
};

const googleSheetsSchema = z.object({
  GOOGLE_SHEETS_ID: z.string().trim().min(1),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().trim().email(),
  GOOGLE_PRIVATE_KEY: z.string().trim().min(1)
});

const whatsAppSchema = z.object({
  WHATSAPP_PHONE_NUMBER_ID: z.string().trim().min(1),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().trim().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().trim().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().trim().min(1)
});

const templateSchema = z.object({
  WHATSAPP_TEMPLATE_NAME: z.string().trim().min(1),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().trim().min(1)
});

const metaAdsSchema = z.object({
  META_ADS_ACCESS_TOKEN: z.string().trim().min(1),
  META_AD_ACCOUNT_ID: z.string().trim().min(1),
  FACEBOOK_PAGE_ID: z.string().trim().min(1),
  META_BUSINESS_ID: z.string().trim().optional().nullable(),
  INSTAGRAM_ACTOR_ID: z.string().trim().optional().nullable(),
  META_PIXEL_ID: z.string().trim().optional().nullable()
});

const aiModelSchema = z.object({
  AI_PROVIDER: z.enum(["OPENAI", "ANTHROPIC", "GEMINI", "CUSTOM"]),
  AI_MODEL_NAME: z.string().trim().min(1),
  AI_API_KEY: z.string().trim().min(1),
  AI_BASE_URL: z.string().trim().optional().nullable()
}).superRefine((value, ctx) => {
  if (value.AI_PROVIDER === "CUSTOM" && !value.AI_BASE_URL?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["AI_BASE_URL"], message: "AI_BASE_URL wrong" });
  }
});

const fieldErrors: Record<string, string> = {
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

function parseConfig<T extends ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  const field = String(parsed.error.issues[0]?.path[0] || "form");
  throw new AppError(fieldErrors[field] ?? "Integration configuration wrong", 400);
}

function normalizePrivateKey(value: string) {
  return value.trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n").trim();
}

function graphErrorMessage(data: unknown) {
  return (data as { error?: { message?: string } })?.error?.message || "";
}

function apiVersion() {
  return env.WHATSAPP_API_VERSION || "v20.0";
}

function ok(message: string, metadata: Record<string, unknown> = {}): VerificationResult {
  return { status: IntegrationStatus.CONNECTED, message, metadata: scrubSecretsFromLogs(metadata) };
}

function failed(message: string, metadata: Record<string, unknown> = {}): VerificationResult {
  return { status: IntegrationStatus.ERROR, message, metadata: scrubSecretsFromLogs(metadata) };
}

function providerStatus(error: unknown) {
  return Number((error as { code?: number; status?: number })?.code || (error as { status?: number })?.status || 500);
}

async function verifyGoogleSheets(companyId: string, input?: Record<string, unknown>) {
  const { config } = await companyIntegrationService.resolveConfigForVerification(companyId, IntegrationType.GOOGLE_SHEETS, input);
  const parsed = parseConfig(googleSheetsSchema, config);
  const privateKey = normalizePrivateKey(parsed.GOOGLE_PRIVATE_KEY);

  if (!privateKey.startsWith("-----BEGIN PRIVATE KEY-----") || !privateKey.endsWith("-----END PRIVATE KEY-----")) {
    return failed("GOOGLE_PRIVATE_KEY wrong");
  }

  try {
    const auth = new google.auth.JWT({
      email: parsed.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    });
    const sheets = google.sheets({ version: "v4", auth });
    const response = await sheets.spreadsheets.get({
      spreadsheetId: parsed.GOOGLE_SHEETS_ID,
      fields: "spreadsheetId,properties.title"
    });

    void apiUsageService.log({
      companyId,
      provider: "GOOGLE_SHEETS",
      endpoint: "spreadsheets.get",
      method: "GET",
      statusCode: 200,
      success: true,
      metadata: { fields: "spreadsheetId,properties.title" }
    });

    return ok("Google Sheets connected successfully", {
      spreadsheetTitle: response.data.properties?.title ?? null,
      spreadsheetIdMasked: "saved"
    });
  } catch (error) {
    const status = providerStatus(error);
    void apiUsageService.log({
      companyId,
      provider: "GOOGLE_SHEETS",
      endpoint: "spreadsheets.get",
      method: "GET",
      statusCode: status,
      success: false,
      metadata: { status }
    });

    const message = error instanceof Error ? error.message : "";
    if (status === 404) return failed("GOOGLE_SHEETS_ID wrong");
    if (status === 403) return failed("GOOGLE_SERVICE_ACCOUNT_EMAIL wrong or sheet not shared with service account");
    if (/private key|PEM|DECODER|unsupported|invalid key|secretOrPrivateKey/i.test(message)) return failed("GOOGLE_PRIVATE_KEY wrong");
    if (/email|issuer|invalid_grant|unauthorized_client/i.test(message)) return failed("GOOGLE_SERVICE_ACCOUNT_EMAIL wrong");
    return failed(status === 401 ? "GOOGLE_PRIVATE_KEY wrong" : "GOOGLE_SHEETS_ID wrong");
  }
}

async function fetchGraph(path: string, accessToken: string, params: Record<string, string> = {}) {
  const url = new URL(`https://graph.facebook.com/${apiVersion()}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function verifyWhatsAppCloud(companyId: string, input?: Record<string, unknown>) {
  const { config } = await companyIntegrationService.resolveConfigForVerification(companyId, IntegrationType.WHATSAPP_CLOUD, input);
  const parsed = parseConfig(whatsAppSchema, config);

  if (!parsed.WHATSAPP_VERIFY_TOKEN.trim()) {
    return failed("WHATSAPP_VERIFY_TOKEN wrong");
  }

  const phone = await fetchGraph(`/${parsed.WHATSAPP_PHONE_NUMBER_ID}`, parsed.WHATSAPP_ACCESS_TOKEN, {
    fields: "id,display_phone_number,verified_name"
  });
  void apiUsageService.log({
    companyId,
    provider: "META_WHATSAPP",
    endpoint: `/${parsed.WHATSAPP_PHONE_NUMBER_ID}`,
    method: "GET",
    statusCode: phone.response.status,
    success: phone.response.ok,
    metadata: { fields: "id,display_phone_number,verified_name", error: graphErrorMessage(phone.data) }
  });

  if (!phone.response.ok) {
    if ([401, 403].includes(phone.response.status)) return failed("WHATSAPP_ACCESS_TOKEN wrong");
    return failed("WHATSAPP_PHONE_NUMBER_ID wrong");
  }

  const templates = await fetchGraph(`/${parsed.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`, parsed.WHATSAPP_ACCESS_TOKEN, {
    fields: "name,language,status",
    limit: "5"
  });
  void apiUsageService.log({
    companyId,
    provider: "META_WHATSAPP",
    endpoint: `/${parsed.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`,
    method: "GET",
    statusCode: templates.response.status,
    success: templates.response.ok,
    metadata: { fields: "name,language,status", error: graphErrorMessage(templates.data) }
  });

  if (!templates.response.ok) {
    if ([401, 403].includes(templates.response.status)) return failed("WHATSAPP_ACCESS_TOKEN wrong");
    return failed("WHATSAPP_BUSINESS_ACCOUNT_ID wrong");
  }

  const phoneData = phone.data as { display_phone_number?: string; verified_name?: string };
  return ok("WhatsApp Cloud API connected successfully", {
    displayPhoneNumber: phoneData.display_phone_number ?? null,
    verifiedName: phoneData.verified_name ?? null,
    verifyTokenSaved: true,
    templateReadAccess: true
  });
}

async function verifyTemplateSettings(companyId: string, input?: Record<string, unknown>) {
  await companyIntegrationService.assertConnected(
    companyId,
    IntegrationType.WHATSAPP_CLOUD,
    "WHATSAPP_ACCESS_TOKEN wrong or WhatsApp integration not connected"
  );
  const { config } = await companyIntegrationService.resolveConfigForVerification(companyId, IntegrationType.WHATSAPP_TEMPLATE_SETTINGS, input);
  const parsed = parseConfig(templateSchema, config);
  const whatsApp = await companyIntegrationService.whatsApp(companyId, {});
  const templates = await fetchGraph(`/${whatsApp.businessAccountId}/message_templates`, whatsApp.accessToken, {
    fields: "name,language,status",
    limit: "100"
  });
  void apiUsageService.log({
    companyId,
    provider: "META_WHATSAPP",
    endpoint: `/${whatsApp.businessAccountId}/message_templates`,
    method: "GET",
    statusCode: templates.response.status,
    success: templates.response.ok,
    metadata: { fields: "name,language,status", purpose: "template_settings_verify" }
  });

  if (!templates.response.ok) {
    return failed("WHATSAPP_ACCESS_TOKEN wrong or WhatsApp integration not connected");
  }

  const rows = (templates.data as { data?: Array<{ name?: string; language?: string; status?: string }> }).data ?? [];
  const templateRows = rows.filter((item) => item.name === parsed.WHATSAPP_TEMPLATE_NAME);
  if (!templateRows.length) return failed("WHATSAPP_TEMPLATE_NAME wrong");

  const languageRow = templateRows.find((item) => item.language === parsed.WHATSAPP_TEMPLATE_LANGUAGE);
  if (!languageRow) return failed("WHATSAPP_TEMPLATE_LANGUAGE wrong");
  if (String(languageRow.status || "").toUpperCase() !== "APPROVED") {
    return failed("WHATSAPP_TEMPLATE_NAME wrong", { templateStatus: languageRow.status ?? null });
  }

  return ok("WhatsApp template settings verified", {
    templateName: parsed.WHATSAPP_TEMPLATE_NAME,
    templateLanguage: parsed.WHATSAPP_TEMPLATE_LANGUAGE,
    templateStatus: languageRow.status ?? null
  });
}

async function verifyMetaAds(companyId: string, input?: Record<string, unknown>) {
  const { config } = await companyIntegrationService.resolveConfigForVerification(companyId, IntegrationType.META_ADS, input);
  const parsed = parseConfig(metaAdsSchema, config);
  return metaAdsVerificationService.verifyMetaAdsIntegration(companyId, parsed);
}

async function verifyKnowledgeBase(companyId: string, input?: Record<string, unknown>, file?: Express.Multer.File) {
  const { config } = await companyIntegrationService.resolveConfigForVerification(companyId, IntegrationType.KNOWLEDGE_BASE, input);
  const websiteUrl = typeof config.websiteUrl === "string" ? config.websiteUrl.trim() : "";

  if (file) {
    try {
      const result = await knowledgeIngestionService.ingestUpload({
        originalName: file.originalname,
        mimeType: file.mimetype,
        buffer: file.buffer
      }, {
        companyId,
        title: file.originalname,
        category: "uploaded_document"
      });
      if (result.created <= 0) return failed("PDF file wrong", { indexStatus: "FAILED" });
      return ok("Knowledge Base indexed successfully", {
        indexStatus: "INDEXED",
        sourceType: "UPLOAD",
        documentName: file.originalname,
        chunksCreated: result.created,
        sourceKey: result.sourceKey
      });
    } catch {
      return failed("PDF file wrong", { indexStatus: "FAILED" });
    }
  }

  if (!websiteUrl) {
    return failed("Company website wrong", { indexStatus: "FAILED" });
  }

  try {
    new URL(websiteUrl);
  } catch {
    return failed("Company website wrong", { indexStatus: "FAILED" });
  }

  try {
    const result = await knowledgeIngestionService.ingestWebsite(websiteUrl, {
      companyId,
      titlePrefix: "Company Website",
      category: "website",
      maxPages: 1
    });
    if (result.chunksCreated <= 0) return failed("Company website wrong", { indexStatus: "FAILED" });
    return ok("Knowledge Base indexed successfully", {
      indexStatus: "INDEXED",
      sourceType: "WEBSITE",
      websiteUrl,
      pagesVisited: result.pagesVisited,
      pagesStored: result.pagesStored,
      chunksCreated: result.chunksCreated
    });
  } catch {
    return failed("Company website wrong", { indexStatus: "FAILED" });
  }
}

function aiEndpointFor(provider: string, baseUrl?: string | null) {
  if (provider === "OPENAI") return "https://api.openai.com/v1/chat/completions";
  if (provider === "ANTHROPIC") return "https://api.anthropic.com/v1/messages";
  if (provider === "CUSTOM") {
    try {
      const url = new URL(baseUrl ?? "");
      url.pathname = `${url.pathname.replace(/\/$/, "")}/chat/completions`;
      return url.toString();
    } catch {
      throw new AppError("AI_BASE_URL wrong", 400);
    }
  }
  return "";
}

async function verifyAIModel(companyId: string, input?: Record<string, unknown>) {
  const { config } = await companyIntegrationService.resolveConfigForVerification(companyId, IntegrationType.AI_MODEL, input);
  const parsed = parseConfig(aiModelSchema, {
    ...config,
    AI_PROVIDER: String(config.AI_PROVIDER || "").toUpperCase()
  });
  const provider = parsed.AI_PROVIDER;

  try {
    let response: Response;
    if (provider === "ANTHROPIC") {
      response = await fetch(aiEndpointFor(provider), {
        method: "POST",
        headers: {
          "x-api-key": parsed.AI_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: parsed.AI_MODEL_NAME,
          max_tokens: 5,
          messages: [{ role: "user", content: "Reply with OK." }]
        })
      });
    } else if (provider === "GEMINI") {
      const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${parsed.AI_MODEL_NAME}:generateContent`);
      url.searchParams.set("key", parsed.AI_API_KEY);
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with OK." }] }] })
      });
    } else {
      response = await fetch(aiEndpointFor(provider, parsed.AI_BASE_URL), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${parsed.AI_API_KEY}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: parsed.AI_MODEL_NAME,
          messages: [{ role: "user", content: "Reply with OK." }],
          max_tokens: 5,
          temperature: 0
        })
      });
    }

    const data = await response.json().catch(() => ({}));
    void apiUsageService.log({
      companyId,
      provider: provider === "ANTHROPIC" ? "CLAUDE" : "INTERNAL",
      endpoint: provider.toLowerCase(),
      method: "POST",
      statusCode: response.status,
      success: response.ok,
      metadata: { model: parsed.AI_MODEL_NAME, provider }
    });

    if (!response.ok) {
      const message = JSON.stringify(data).slice(0, 400);
      if ([401, 403].includes(response.status)) return failed("AI_API_KEY wrong");
      if (provider === "CUSTOM" && [404, 405].includes(response.status)) return failed("AI_BASE_URL wrong");
      if (/model|not found|does not exist|permission/i.test(message) || response.status === 404) return failed("AI_MODEL_NAME wrong");
      return failed(response.status >= 500 && provider === "CUSTOM" ? "AI_BASE_URL wrong" : "AI_API_KEY wrong");
    }

    return ok("AI model connected successfully", {
      provider,
      modelName: parsed.AI_MODEL_NAME,
      baseUrl: provider === "CUSTOM" ? parsed.AI_BASE_URL : null
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    return failed(provider === "CUSTOM" ? "AI_BASE_URL wrong" : "AI_API_KEY wrong");
  }
}

async function runVerifier(companyId: string, type: IntegrationType, input?: Record<string, unknown>, file?: Express.Multer.File) {
  switch (type) {
    case IntegrationType.GOOGLE_SHEETS:
      return verifyGoogleSheets(companyId, input);
    case IntegrationType.WHATSAPP_CLOUD:
      return verifyWhatsAppCloud(companyId, input);
    case IntegrationType.WHATSAPP_TEMPLATE_SETTINGS:
      return verifyTemplateSettings(companyId, input);
    case IntegrationType.META_ADS:
      return verifyMetaAds(companyId, input);
    case IntegrationType.KNOWLEDGE_BASE:
      return verifyKnowledgeBase(companyId, input, file);
    case IntegrationType.AI_MODEL:
      return verifyAIModel(companyId, input);
    default:
      return failed("Unknown integration type.");
  }
}

export const integrationVerificationService = {
  async verify(companyId: string, typeValue: string, options: VerifyOptions = {}) {
    const type = companyIntegrationService.normalizeType(typeValue);
    let result: VerificationResult;

    try {
      result = await runVerifier(companyId, type, options.input, options.file);
    } catch (error) {
      result = failed(error instanceof Error ? error.message : "Integration verification failed");
    }

    const action = result.status === IntegrationStatus.CONNECTED
      ? type === IntegrationType.KNOWLEDGE_BASE ? "knowledge_base.indexed" : "integration.verified"
      : "integration.failed_verification";
    const integration = options.persist
      ? await companyIntegrationService.updateVerificationResult(companyId, type, result, options.actorUserId, action)
      : undefined;

    return {
      status: result.status,
      message: result.message,
      metadata: scrubSecretsFromLogs(result.metadata ?? {}),
      integration
    };
  },

  async test(companyId: string, typeValue: string, options: VerifyOptions = {}) {
    const result = await this.verify(companyId, typeValue, { ...options, persist: false });
    await companyIntegrationService.recordAudit({
      companyId,
      typeValue,
      action: "integration.tested",
      actorUserId: options.actorUserId,
      status: result.status,
      metadata: { message: result.message, ...(result.metadata ?? {}) }
    });
    return result;
  }
};
