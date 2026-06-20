import { IntegrationStatus } from "@prisma/client";
import { env } from "../config/env.js";
import { apiUsageService } from "./apiUsage.service.js";
import { scrubSecretsFromLogs } from "../utils/secretVault.js";

type VerificationResult = {
  status: IntegrationStatus;
  message: string;
  metadata?: Record<string, unknown>;
};

type MetaAdsVerificationConfig = {
  META_ADS_ACCESS_TOKEN?: string;
  META_AD_ACCOUNT_ID?: string;
  FACEBOOK_PAGE_ID?: string;
  META_BUSINESS_ID?: string | null;
  INSTAGRAM_ACTOR_ID?: string | null;
  META_PIXEL_ID?: string | null;
};

type GraphResult = {
  response: Response;
  data: Record<string, unknown>;
};

const REQUIRED_PERMISSIONS = ["ads_management", "ads_read"] as const;

function apiVersion() {
  return env.WHATSAPP_API_VERSION || "v20.0";
}

function clean(value?: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed || "";
}

export function normalizeMetaAdAccountId(value?: string | null) {
  const cleaned = clean(value).replace(/^act_+/i, "");
  return cleaned ? `act_${cleaned}` : "";
}

function ok(message: string, metadata: Record<string, unknown> = {}): VerificationResult {
  return { status: IntegrationStatus.CONNECTED, message, metadata: scrubSecretsFromLogs(metadata) };
}

function failed(message: string, metadata: Record<string, unknown> = {}): VerificationResult {
  return { status: IntegrationStatus.ERROR, message, metadata: scrubSecretsFromLogs(metadata) };
}

function graphErrorMessage(data: unknown) {
  return (data as { error?: { message?: string } })?.error?.message || "";
}

function isActiveAdAccount(status: unknown) {
  const normalized = String(status ?? "").trim().toUpperCase();
  return normalized === "1" || normalized === "ACTIVE";
}

function permissionRows(data: Record<string, unknown>) {
  return (Array.isArray(data.data) ? data.data : []) as Array<{ permission?: string; status?: string }>;
}

function isVerificationResult(value: unknown): value is VerificationResult {
  return Boolean(value && typeof value === "object" && "status" in value && "message" in value);
}

function hasPermission(data: Record<string, unknown>, permission: string) {
  return permissionRows(data).some((row) => row.permission === permission && String(row.status || "").toLowerCase() === "granted");
}

async function fetchGraph(
  tenantId: string,
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
  purpose = "verify"
): Promise<GraphResult> {
  const url = new URL(`https://graph.facebook.com/${apiVersion()}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;

    void apiUsageService.log({
      companyId: tenantId,
      provider: "META_ADS",
      endpoint: path,
      method: "GET",
      statusCode: response.status,
      success: response.ok,
      metadata: {
        purpose,
        fields: params.fields,
        error: graphErrorMessage(data)
      }
    });

    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyOptionalAsset(input: {
  tenantId: string;
  token: string;
  id: string;
  fields: string;
  errorMessage: string;
  purpose: string;
}) {
  if (!input.id) return null;

  const result = await fetchGraph(input.tenantId, `/${input.id}`, input.token, { fields: input.fields }, input.purpose);
  if (!result.response.ok) {
    return failed(input.errorMessage);
  }

  return result.data;
}

export const metaAdsVerificationService = {
  async verifyMetaAdsIntegration(tenantId: string, config: MetaAdsVerificationConfig): Promise<VerificationResult> {
    const token = clean(config.META_ADS_ACCESS_TOKEN);
    const adAccountId = normalizeMetaAdAccountId(config.META_AD_ACCOUNT_ID);
    const pageId = clean(config.FACEBOOK_PAGE_ID);
    const instagramActorId = clean(config.INSTAGRAM_ACTOR_ID);
    const businessId = clean(config.META_BUSINESS_ID);

    if (!token) return failed("META_ADS_ACCESS_TOKEN wrong");
    if (!adAccountId) return failed("META_AD_ACCOUNT_ID wrong");
    if (!pageId) return failed("FACEBOOK_PAGE_ID wrong");

    const permissions = await fetchGraph(tenantId, "/me/permissions", token, {}, "permissions_verify");
    if (!permissions.response.ok) return failed("META_ADS_ACCESS_TOKEN wrong");

    for (const permission of REQUIRED_PERMISSIONS) {
      if (!hasPermission(permissions.data, permission)) {
        return failed(`Meta Ads permission missing: ${permission}`);
      }
    }

    const account = await fetchGraph(tenantId, `/${adAccountId}`, token, {
      fields: "id,name,account_status,currency,timezone_name"
    }, "ad_account_verify");

    if (!account.response.ok) {
      if (account.response.status === 401) return failed("META_ADS_ACCESS_TOKEN wrong");
      if (account.response.status === 403) return failed("Meta Ads account is disabled or not accessible");
      return failed("META_AD_ACCOUNT_ID wrong");
    }

    const accountStatus = account.data.account_status;
    if (!isActiveAdAccount(accountStatus)) {
      return failed("Meta Ads account is disabled or not accessible", {
        accountStatus
      });
    }

    const page = await fetchGraph(tenantId, `/${pageId}`, token, { fields: "id,name" }, "facebook_page_verify");
    if (!page.response.ok) return failed("FACEBOOK_PAGE_ID wrong");

    const instagram = await verifyOptionalAsset({
      tenantId,
      token,
      id: instagramActorId,
      fields: "id,username",
      errorMessage: "INSTAGRAM_ACTOR_ID wrong",
      purpose: "instagram_actor_verify"
    });
    if (isVerificationResult(instagram)) return instagram;

    const business = await verifyOptionalAsset({
      tenantId,
      token,
      id: businessId,
      fields: "id,name",
      errorMessage: "META_BUSINESS_ID wrong",
      purpose: "business_verify"
    });
    if (isVerificationResult(business)) return business;

    return ok("Meta Ads connected successfully", {
      adAccountId,
      adAccountName: account.data.name ?? null,
      accountStatus,
      currency: account.data.currency ?? null,
      timezone: account.data.timezone_name ?? null,
      pageId: page.data.id ?? pageId,
      pageName: page.data.name ?? null,
      instagramActorId: instagramActorId || null,
      instagramUsername: instagram && "username" in instagram ? instagram.username ?? null : null,
      businessId: businessId || null,
      businessName: business && "name" in business ? business.name ?? null : null,
      metaPixelId: clean(config.META_PIXEL_ID) || null,
      lastVerifiedAt: new Date().toISOString()
    });
  }
};
