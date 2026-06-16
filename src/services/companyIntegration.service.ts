import crypto from "node:crypto";
import type { CompanyIntegration } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/errors.js";
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
  const key = clean(env.INTEGRATION_ENCRYPTION_KEY);
  if (!key) throw new AppError("INTEGRATION_ENCRYPTION_KEY is required before saving integration secrets.", 500);
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

function decryptSecret(value?: string | null) {
  if (!value) return null;
  const [version, ivValue, tagValue, ciphertextValue] = value.split(":");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new AppError("Stored integration secret format is invalid.", 500);
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function maskEncryptedSecret(value?: string | null) {
  return value ? "Saved secret" : null;
}

function publicIntegration(row: CompanyIntegration | null) {
  return {
    companyId: row?.companyId ?? null,
    googleSheetsId: row?.googleSheetsId ?? null,
    googleServiceAccountEmail: row?.googleServiceAccountEmail ?? null,
    googlePrivateKeyMasked: maskEncryptedSecret(row?.googlePrivateKeyEncrypted),
    whatsappPhoneNumberId: row?.whatsappPhoneNumberId ?? null,
    whatsappBusinessAccountId: row?.whatsappBusinessAccountId ?? null,
    whatsappAccessTokenMasked: maskEncryptedSecret(row?.whatsappAccessTokenEncrypted),
    whatsappVerifyToken: row?.whatsappVerifyToken ? `********${row.whatsappVerifyToken.slice(-4)}` : null,
    whatsappDefaultTemplateName: row?.whatsappDefaultTemplateName ?? null,
    whatsappTemplateLanguage: row?.whatsappTemplateLanguage ?? "en",
    metaAdAccountId: row?.metaAdAccountId ?? null,
    metaAdsAccessTokenMasked: maskEncryptedSecret(row?.metaAdsAccessTokenEncrypted),
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

  async userStatus(companyId?: string | null) {
    return publicIntegration(await rowForCompany(companyId));
  },

  async googleSheets(companyId?: string | null) {
    const row = await rowForCompany(companyId);
    if (row?.googleSheetsId && row.googleServiceAccountEmail && row.googlePrivateKeyEncrypted) {
      return {
        spreadsheetId: row.googleSheetsId,
        serviceAccountEmail: row.googleServiceAccountEmail,
        privateKey: decryptSecret(row.googlePrivateKeyEncrypted) ?? ""
      };
    }
    const fallback = envGoogleFallback();
    if (fallback) return fallback;
    throw new AppError("Google Sheets not connected.", 400);
  },

  async whatsApp(companyId?: string | null) {
    const row = await rowForCompany(companyId);
    if (row?.whatsappPhoneNumberId && row.whatsappAccessTokenEncrypted) {
      return {
        phoneNumberId: row.whatsappPhoneNumberId,
        businessAccountId: row.whatsappBusinessAccountId,
        accessToken: decryptSecret(row.whatsappAccessTokenEncrypted) ?? "",
        verifyToken: row.whatsappVerifyToken,
        templateName: row.whatsappDefaultTemplateName,
        templateLanguage: row.whatsappTemplateLanguage || "en"
      };
    }
    const fallback = envWhatsAppFallback();
    if (fallback) return fallback;
    throw new AppError("WhatsApp not connected for your company.", 400);
  },

  async metaAds(companyId?: string | null) {
    const row = await rowForCompany(companyId);
    if (row?.metaAdAccountId && row.metaAdsAccessTokenEncrypted) {
      return {
        adAccountId: row.metaAdAccountId,
        accessToken: decryptSecret(row.metaAdsAccessTokenEncrypted) ?? ""
      };
    }
    const fallback = envMetaFallback();
    if (fallback) return fallback;
    throw new AppError("Meta Ads not connected for your company.", 400);
  },

  async findCompanyByWhatsAppPhoneNumberId(phoneNumberId?: string | null) {
    if (!phoneNumberId) return null;
    const row = await prisma.companyIntegration.findFirst({
      where: { whatsappPhoneNumberId: phoneNumberId },
      select: { companyId: true }
    });
    if (row) return row.companyId;
    if (env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_PHONE_NUMBER_ID === phoneNumberId) {
      const company = await prisma.company.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
      return company?.id ?? null;
    }
    return null;
  },

  async acceptsWebhookVerifyToken(token?: string | null) {
    const verifyToken = clean(token);
    if (!verifyToken) return false;
    if (env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_VERIFY_TOKEN === verifyToken) return true;
    const row = await prisma.companyIntegration.findFirst({
      where: { whatsappVerifyToken: verifyToken },
      select: { id: true }
    });
    return Boolean(row);
  },

  async testWhatsApp(companyId: string) {
    const credentials = await this.whatsApp(companyId);
    const endpoint = `/${credentials.phoneNumberId}`;
    const url = new URL(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}${endpoint}`);
    url.searchParams.set("fields", "id,display_phone_number,verified_name");

    try {
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
        error: response.ok ? null : data.error?.message || `WhatsApp API returned HTTP ${response.status}.`
      };
    } catch (error) {
      void apiUsageService.log({
        companyId,
        provider: "META_WHATSAPP",
        endpoint,
        method: "GET",
        statusCode: 500,
        success: false,
        metadata: { error: error instanceof Error ? error.message : "WhatsApp test failed" }
      });
      return {
        provider: "whatsapp",
        connected: false,
        phoneNumberId: credentials.phoneNumberId,
        businessAccountId: credentials.businessAccountId ?? null,
        displayPhoneNumber: null,
        verifiedName: null,
        error: error instanceof Error ? error.message : "WhatsApp test failed."
      };
    }
  },

  async testMetaAds(companyId: string) {
    const credentials = await this.metaAds(companyId);
    const normalizedAccountId = credentials.adAccountId.startsWith("act_") ? credentials.adAccountId : `act_${credentials.adAccountId}`;
    const endpoint = `/${normalizedAccountId}`;
    const url = new URL(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}${endpoint}`);
    url.searchParams.set("fields", "name,account_status,currency,timezone_name");

    try {
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
        error: response.ok ? null : data.error?.message || `Meta Ads API returned HTTP ${response.status}.`
      };
    } catch (error) {
      void apiUsageService.log({
        companyId,
        provider: "META_ADS",
        endpoint,
        method: "GET",
        statusCode: 500,
        success: false,
        metadata: { error: error instanceof Error ? error.message : "Meta Ads test failed" }
      });
      return {
        provider: "metaAds",
        connected: false,
        adAccountId: credentials.adAccountId,
        accountName: null,
        accountStatus: null,
        currency: null,
        timezone: null,
        error: error instanceof Error ? error.message : "Meta Ads test failed."
      };
    }
  }
};
