import crypto from "node:crypto";
import type { CompanyIntegration } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/errors.js";
import { integrationEncryptionKeyConfigured, localIntegrationFallbackEnabled } from "../utils/integrationConfig.js";
import { apiUsageService } from "./apiUsage.service.js";

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
};

export type GoogleSheetsIntegrationInput = Pick<IntegrationInput, "googleSheetsId" | "googleServiceAccountEmail" | "googlePrivateKey">;
export type WhatsAppIntegrationInput = Pick<IntegrationInput, "whatsappPhoneNumberId" | "whatsappBusinessAccountId" | "whatsappAccessToken" | "whatsappVerifyToken" | "whatsappDefaultTemplateName" | "whatsappTemplateLanguage">;
export type MetaAdsIntegrationInput = Pick<IntegrationInput, "metaAdAccountId" | "metaAdsAccessToken">;
type IntegrationTestProvider = "googleSheets" | "whatsapp" | "metaAds";
type SecretDebugInput = GoogleSheetsIntegrationInput & WhatsAppIntegrationInput & MetaAdsIntegrationInput;

export type GoogleSheetsCredentials = {
  spreadsheetId: string;
  serviceAccountEmail: string;
  privateKey: string;
};

export type WhatsAppCredentials = {
  phoneNumberId: string;
  businessAccountId?: string | null;
  accessToken: string;
  verifyToken?: string | null;
  templateName?: string | null;
  templateLanguage: string;
};

export type MetaAdsCredentials = {
  adAccountId: string;
  accessToken: string;
};

function clean(value?: string | null) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

function encryptionKey() {
  const key = clean(process.env.INTEGRATION_ENCRYPTION_KEY);
  if (!key) throw new AppError("Encryption key missing. Add INTEGRATION_ENCRYPTION_KEY and restart server.", 500);
  return crypto.createHash("sha256").update(key).digest();
}

function encryptSecret(value?: string | null) {
  const secret = clean(value);
  if (!secret) return undefined;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

function integrationDecryptError() {
  return new AppError("Saved secret cannot be decrypted. Clear and re-enter the credential.", 400);
}

function decryptSecret(value?: string | null) {
  if (!value) return null;
  const [version, ivValue, tagValue, ciphertextValue] = value.split(":");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw integrationDecryptError();
  }
  const key = encryptionKey();
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw integrationDecryptError();
  }
}

function savedSecretLabel(value: string | null | undefined, label: string) {
  return value ? label : null;
}

function publicIntegration(row: CompanyIntegration | null) {
  return {
    companyId: row?.companyId ?? null,
    googleSheetsId: row?.googleSheetsId ?? null,
    googleServiceAccountEmail: row?.googleServiceAccountEmail ?? null,
    googlePrivateKeyMasked: savedSecretLabel(row?.googlePrivateKeyEncrypted, "Key saved"),
    whatsappPhoneNumberId: row?.whatsappPhoneNumberId ?? null,
    whatsappBusinessAccountId: row?.whatsappBusinessAccountId ?? null,
    whatsappAccessTokenMasked: savedSecretLabel(row?.whatsappAccessTokenEncrypted, "Token saved"),
    whatsappVerifyToken: row?.whatsappVerifyToken ? `********${row.whatsappVerifyToken.slice(-4)}` : null,
    whatsappDefaultTemplateName: row?.whatsappDefaultTemplateName ?? null,
    whatsappTemplateLanguage: row?.whatsappTemplateLanguage ?? "en",
    metaAdAccountId: row?.metaAdAccountId ?? null,
    metaAdsAccessTokenMasked: savedSecretLabel(row?.metaAdsAccessTokenEncrypted, "Token saved"),
    connected: {
      googleSheets: Boolean(row?.googleSheetsId && row.googleServiceAccountEmail && row.googlePrivateKeyEncrypted),
      whatsapp: Boolean(row?.whatsappPhoneNumberId && row.whatsappAccessTokenEncrypted),
      metaAds: Boolean(row?.metaAdAccountId && row.metaAdsAccessTokenEncrypted)
    },
    updatedAt: row?.updatedAt ?? null
  };
}

function envGoogleFallback(): GoogleSheetsCredentials | null {
  if (!env.GOOGLE_SHEETS_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) return null;
  return {
    spreadsheetId: env.GOOGLE_SHEETS_ID,
    serviceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_PRIVATE_KEY
  };
}

function shouldUseEnvFallback(companyId?: string | null) {
  return localIntegrationFallbackEnabled();
}

function missingGoogleSheetsConfig(spreadsheetId?: string | null, serviceAccountEmail?: string | null, privateKey?: string | null) {
  if (!spreadsheetId) return "Sheet ID missing.";
  if (!serviceAccountEmail) return "Service account email missing.";
  if (!privateKey) return "Private key missing.";
  return null;
}

function missingWhatsAppConfig(phoneNumberId?: string | null, accessToken?: string | null) {
  if (!phoneNumberId) return "WhatsApp phone number ID missing.";
  if (!accessToken) return "WhatsApp access token missing.";
  return null;
}

function missingMetaAdsConfig(adAccountId?: string | null, accessToken?: string | null) {
  if (!adAccountId) return "Meta Ads account ID missing.";
  if (!accessToken) return "Meta Ads access token missing.";
  return null;
}

function envWhatsAppFallback(): WhatsAppCredentials | null {
  if (!env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_ACCESS_TOKEN) return null;
  return {
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? null,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN ?? null,
    templateName: env.WHATSAPP_TEMPLATE_NAME ?? null,
    templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE
  };
}

function envMetaFallback(): MetaAdsCredentials | null {
  if (!env.META_AD_ACCOUNT_ID || !env.META_ADS_ACCESS_TOKEN) return null;
  return {
    adAccountId: env.META_AD_ACCOUNT_ID,
    accessToken: env.META_ADS_ACCESS_TOKEN
  };
}

async function rowForCompany(companyId?: string | null) {
  if (!companyId) return null;
  return prisma.companyIntegration.findUnique({ where: { companyId } });
}

export const companyIntegrationService = {
  async listAdmin(companyId?: string | null) {
    if (companyId) {
      return publicIntegration(await rowForCompany(companyId));
    }
    const rows = await prisma.companyIntegration.findMany({ orderBy: { updatedAt: "desc" } });
    return rows.map(publicIntegration);
  },

  async updateAdmin(companyId: string, input: IntegrationInput) {
    await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { id: true } });
    const existing = await rowForCompany(companyId);
    const googlePrivateKeyEncrypted = encryptSecret(input.googlePrivateKey);
    const whatsappAccessTokenEncrypted = encryptSecret(input.whatsappAccessToken);
    const metaAdsAccessTokenEncrypted = encryptSecret(input.metaAdsAccessToken);

    const row = await prisma.companyIntegration.upsert({
      where: { companyId },
      create: {
        companyId,
        googleSheetsId: clean(input.googleSheetsId),
        googleServiceAccountEmail: clean(input.googleServiceAccountEmail),
        googlePrivateKeyEncrypted: googlePrivateKeyEncrypted ?? null,
        whatsappPhoneNumberId: clean(input.whatsappPhoneNumberId),
        whatsappBusinessAccountId: clean(input.whatsappBusinessAccountId),
        whatsappAccessTokenEncrypted: whatsappAccessTokenEncrypted ?? null,
        whatsappVerifyToken: clean(input.whatsappVerifyToken),
        whatsappDefaultTemplateName: clean(input.whatsappDefaultTemplateName),
        whatsappTemplateLanguage: clean(input.whatsappTemplateLanguage) || "en",
        metaAdAccountId: clean(input.metaAdAccountId),
        metaAdsAccessTokenEncrypted: metaAdsAccessTokenEncrypted ?? null
      },
      update: {
        googleSheetsId: clean(input.googleSheetsId),
        googleServiceAccountEmail: clean(input.googleServiceAccountEmail),
        googlePrivateKeyEncrypted: googlePrivateKeyEncrypted ?? existing?.googlePrivateKeyEncrypted ?? null,
        whatsappPhoneNumberId: clean(input.whatsappPhoneNumberId),
        whatsappBusinessAccountId: clean(input.whatsappBusinessAccountId),
        whatsappAccessTokenEncrypted: whatsappAccessTokenEncrypted ?? existing?.whatsappAccessTokenEncrypted ?? null,
        whatsappVerifyToken: clean(input.whatsappVerifyToken) ?? existing?.whatsappVerifyToken ?? null,
        whatsappDefaultTemplateName: clean(input.whatsappDefaultTemplateName),
        whatsappTemplateLanguage: clean(input.whatsappTemplateLanguage) || existing?.whatsappTemplateLanguage || "en",
        metaAdAccountId: clean(input.metaAdAccountId),
        metaAdsAccessTokenEncrypted: metaAdsAccessTokenEncrypted ?? existing?.metaAdsAccessTokenEncrypted ?? null
      }
    });
    return publicIntegration(row);
  },

  async clearProvider(companyId: string, provider: "googleSheets" | "whatsapp" | "metaAds") {
    await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { id: true } });
    const data = {
      ...(provider === "googleSheets" ? { googlePrivateKeyEncrypted: null } : {}),
      ...(provider === "whatsapp" ? { whatsappAccessTokenEncrypted: null } : {}),
      ...(provider === "metaAds" ? { metaAdsAccessTokenEncrypted: null } : {})
    };
    const row = await prisma.companyIntegration.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data
    });
    return publicIntegration(row);
  },

  async userStatus(companyId?: string | null) {
    return publicIntegration(await rowForCompany(companyId));
  },

  async integrationSecretState(provider: IntegrationTestProvider, companyId?: string | null, input?: SecretDebugInput) {
    const row = await rowForCompany(companyId);
    const accessTokenProvidedInRequest = provider === "whatsapp"
      ? Boolean(clean(input?.whatsappAccessToken))
      : provider === "metaAds"
        ? Boolean(clean(input?.metaAdsAccessToken))
        : false;
    const savedAccessTokenExists = provider === "whatsapp"
      ? Boolean(row?.whatsappAccessTokenEncrypted)
      : provider === "metaAds"
        ? Boolean(row?.metaAdsAccessTokenEncrypted)
        : false;
    return {
      accessTokenProvidedInRequest,
      savedAccessTokenExists,
      privateKeyProvidedInRequest: provider === "googleSheets" ? Boolean(clean(input?.googlePrivateKey)) : false,
      savedPrivateKeyExists: provider === "googleSheets" ? Boolean(row?.googlePrivateKeyEncrypted) : false,
      encryptionKeyConfigured: integrationEncryptionKeyConfigured()
    };
  },

  async googleSheets(companyId?: string | null, input?: GoogleSheetsIntegrationInput) {
    const row = await rowForCompany(companyId);
    const requestPrivateKey = clean(input?.googlePrivateKey);
    const spreadsheetId = clean(input?.googleSheetsId) ?? row?.googleSheetsId ?? null;
    const serviceAccountEmail = clean(input?.googleServiceAccountEmail) ?? row?.googleServiceAccountEmail ?? null;
    const savedPrivateKeyExists = Boolean(row?.googlePrivateKeyEncrypted);
    const missingConfig = missingGoogleSheetsConfig(
      spreadsheetId,
      serviceAccountEmail,
      requestPrivateKey ?? (savedPrivateKeyExists ? "saved-secret" : null)
    );
    if (!missingConfig) {
      const privateKey = requestPrivateKey ?? decryptSecret(row?.googlePrivateKeyEncrypted) ?? "";
      return {
        spreadsheetId: spreadsheetId!,
        serviceAccountEmail: serviceAccountEmail!,
        privateKey
      };
    }
    if (shouldUseEnvFallback(companyId)) {
      const fallback = envGoogleFallback();
      if (fallback) return fallback;
    }
    throw new AppError(missingConfig, 400);
  },

  async whatsApp(companyId?: string | null, input?: WhatsAppIntegrationInput) {
    const row = await rowForCompany(companyId);
    const requestAccessToken = clean(input?.whatsappAccessToken);
    const phoneNumberId = clean(input?.whatsappPhoneNumberId) ?? row?.whatsappPhoneNumberId ?? null;
    const savedAccessTokenExists = Boolean(row?.whatsappAccessTokenEncrypted);
    const missingConfig = missingWhatsAppConfig(
      phoneNumberId,
      requestAccessToken ?? (savedAccessTokenExists ? "saved-secret" : null)
    );
    if (!missingConfig) {
      const accessToken = requestAccessToken ?? decryptSecret(row?.whatsappAccessTokenEncrypted) ?? "";
      return {
        phoneNumberId: phoneNumberId!,
        businessAccountId: clean(input?.whatsappBusinessAccountId) ?? row?.whatsappBusinessAccountId,
        accessToken,
        verifyToken: clean(input?.whatsappVerifyToken) ?? row?.whatsappVerifyToken,
        templateName: clean(input?.whatsappDefaultTemplateName) ?? row?.whatsappDefaultTemplateName,
        templateLanguage: clean(input?.whatsappTemplateLanguage) ?? row?.whatsappTemplateLanguage ?? "en"
      };
    }
    if (shouldUseEnvFallback(companyId)) {
      const fallback = envWhatsAppFallback();
      if (fallback) return fallback;
    }
    throw new AppError(missingConfig, 400);
  },

  async metaAds(companyId?: string | null, input?: MetaAdsIntegrationInput) {
    const row = await rowForCompany(companyId);
    const requestAccessToken = clean(input?.metaAdsAccessToken);
    const adAccountId = clean(input?.metaAdAccountId) ?? row?.metaAdAccountId ?? null;
    const savedAccessTokenExists = Boolean(row?.metaAdsAccessTokenEncrypted);
    const missingConfig = missingMetaAdsConfig(
      adAccountId,
      requestAccessToken ?? (savedAccessTokenExists ? "saved-secret" : null)
    );
    if (!missingConfig) {
      const accessToken = requestAccessToken ?? decryptSecret(row?.metaAdsAccessTokenEncrypted) ?? "";
      return {
        adAccountId: adAccountId!,
        accessToken
      };
    }
    if (shouldUseEnvFallback(companyId)) {
      const fallback = envMetaFallback();
      if (fallback) return fallback;
    }
    throw new AppError(missingConfig, 400);
  },

  async findCompanyByWhatsAppPhoneNumberId(phoneNumberId?: string | null) {
    if (!phoneNumberId) return null;
    const row = await prisma.companyIntegration.findFirst({
      where: { whatsappPhoneNumberId: phoneNumberId },
      select: { companyId: true }
    });
    if (row) return row.companyId;
    if (localIntegrationFallbackEnabled() && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_PHONE_NUMBER_ID === phoneNumberId) {
      const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
      return company?.id ?? null;
    }
    return null;
  },

  async acceptsWebhookVerifyToken(token?: string | null) {
    const verifyToken = clean(token);
    if (!verifyToken) return false;
    if (localIntegrationFallbackEnabled() && env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_VERIFY_TOKEN === verifyToken) return true;
    const row = await prisma.companyIntegration.findFirst({
      where: { whatsappVerifyToken: verifyToken },
      select: { id: true }
    });
    return Boolean(row);
  },

  async testWhatsApp(companyId: string, input?: WhatsAppIntegrationInput) {
    const debug = await this.integrationSecretState("whatsapp", companyId, input);
    let credentials: WhatsAppCredentials | null = null;
    let endpoint = "";

    try {
      credentials = await this.whatsApp(companyId, input);
      endpoint = `/${credentials.phoneNumberId}`;
      const url = new URL(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}${endpoint}`);
      url.searchParams.set("fields", "id,display_phone_number,verified_name");
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${credentials.accessToken}` }
      });
      const data = (await response.json().catch(() => ({}))) as {
        id?: string;
        display_phone_number?: string;
        verified_name?: string;
        error?: { message?: string };
      };
      void apiUsageService.log({
        companyId,
        provider: "META_WHATSAPP",
        endpoint,
        method: "GET",
        statusCode: response.status,
        success: response.ok,
        metadata: { fields: "id,display_phone_number,verified_name", error: data.error?.message }
      });

      return {
        provider: "whatsapp",
        connected: response.ok,
        phoneNumberId: credentials.phoneNumberId,
        businessAccountId: credentials.businessAccountId ?? null,
        displayPhoneNumber: data.display_phone_number ?? null,
        verifiedName: data.verified_name ?? null,
        error: response.ok ? null : data.error?.message || `WhatsApp API returned HTTP ${response.status}.`,
        ...debug
      };
    } catch (error) {
      if (credentials) {
        void apiUsageService.log({
          companyId,
          provider: "META_WHATSAPP",
          endpoint,
          method: "GET",
          statusCode: 500,
          success: false,
          metadata: { error: error instanceof Error ? error.message : "WhatsApp test failed" }
        });
      }
      return {
        provider: "whatsapp",
        connected: false,
        phoneNumberId: credentials?.phoneNumberId ?? clean(input?.whatsappPhoneNumberId),
        businessAccountId: credentials?.businessAccountId ?? clean(input?.whatsappBusinessAccountId),
        displayPhoneNumber: null,
        verifiedName: null,
        error: error instanceof Error ? error.message : "WhatsApp test failed.",
        ...debug
      };
    }
  },

  async testMetaAds(companyId: string, input?: MetaAdsIntegrationInput) {
    const debug = await this.integrationSecretState("metaAds", companyId, input);
    let credentials: MetaAdsCredentials | null = null;
    let endpoint = "";

    try {
      credentials = await this.metaAds(companyId, input);
      const normalizedAccountId = credentials.adAccountId.startsWith("act_") ? credentials.adAccountId : `act_${credentials.adAccountId}`;
      endpoint = `/${normalizedAccountId}`;
      const url = new URL(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}${endpoint}`);
      url.searchParams.set("fields", "name,account_status,currency,timezone_name");
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${credentials.accessToken}` }
      });
      const data = (await response.json().catch(() => ({}))) as {
        name?: string;
        account_status?: string | number;
        currency?: string;
        timezone_name?: string;
        error?: { message?: string };
      };
      void apiUsageService.log({
        companyId,
        provider: "META_ADS",
        endpoint,
        method: "GET",
        statusCode: response.status,
        success: response.ok,
        metadata: { fields: "name,account_status,currency,timezone_name", error: data.error?.message }
      });

      return {
        provider: "metaAds",
        connected: response.ok,
        adAccountId: credentials.adAccountId,
        accountName: data.name ?? null,
        accountStatus: data.account_status ?? null,
        currency: data.currency ?? null,
        timezone: data.timezone_name ?? null,
        error: response.ok ? null : data.error?.message || `Meta Ads API returned HTTP ${response.status}.`,
        ...debug
      };
    } catch (error) {
      if (credentials) {
        void apiUsageService.log({
          companyId,
          provider: "META_ADS",
          endpoint,
          method: "GET",
          statusCode: 500,
          success: false,
          metadata: { error: error instanceof Error ? error.message : "Meta Ads test failed" }
        });
      }
      return {
        provider: "metaAds",
        connected: false,
        adAccountId: credentials?.adAccountId ?? clean(input?.metaAdAccountId),
        accountName: null,
        accountStatus: null,
        currency: null,
        timezone: null,
        error: error instanceof Error ? error.message : "Meta Ads test failed.",
        ...debug
      };
    }
  }
};
