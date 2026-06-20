import { IntegrationStatus, LeadTemperature, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/errors.js";
import { scrubSecretsFromLogs } from "../utils/secretVault.js";
import { companyIntegrationService, type MetaAdsCredentials } from "./companyIntegration.service.js";
import { metaAdsVerificationService, normalizeMetaAdAccountId } from "./metaAdsVerification.service.js";
import { apiUsageService } from "./apiUsage.service.js";
import { logger } from "../utils/logger.js";

const ADS_MANAGER_URL = "https://business.facebook.com/adsmanager/manage/campaigns";
const INSIGHTS_PLACEHOLDER = "Insights sync coming after Meta Ads read permission is verified.";

type AdStatus =
  | "DRAFT"
  | "READY_TO_PUBLISH"
  | "PUBLISHING"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"
  | "MANUALLY_LAUNCHED"
  | "CANCELLED";

type AdCampaignInput = {
  name?: string;
  objective?: string;
  platform?: string;
  status?: AdStatus;
  creativeConfig?: unknown;
  audienceConfig?: unknown;
  budgetConfig?: unknown;
  automationConfig?: unknown;
  trackingConfig?: unknown;
};

type ManualLaunchInput = {
  metaAdId?: string;
  metaCampaignId?: string | null;
  metaAdSetId?: string | null;
  launchUrl?: string | null;
};

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return asObject(value) as Prisma.InputJsonValue;
}

function clean(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed || "";
}

function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function defaultStats() {
  return {
    conversationsStarted: 0,
    leadsGenerated: 0,
    hotLeads: 0,
    warmLeads: 0,
    scrapLeads: 0,
    ordersGenerated: 0,
    humanQueueItems: 0,
    replyRate: 0,
    orderConversionRate: 0,
    spend: null,
    costPerConversation: null,
    insightsMessage: INSIGHTS_PLACEHOLDER
  };
}

function statsFrom(value: unknown) {
  return { ...defaultStats(), ...asObject(value) };
}

function publicCampaign(campaign: {
  id: string;
  name: string;
  objective: string;
  platform: string;
  status: string;
  metaBusinessId: string | null;
  metaAdAccountId: string | null;
  metaCampaignId: string | null;
  metaAdSetId: string | null;
  metaCreativeId: string | null;
  metaAdId: string | null;
  facebookPageId: string | null;
  instagramActorId: string | null;
  whatsappPhoneNumberId: string | null;
  creativeConfig: Prisma.JsonValue;
  audienceConfig: Prisma.JsonValue;
  budgetConfig: Prisma.JsonValue;
  automationConfig: Prisma.JsonValue;
  trackingConfig: Prisma.JsonValue;
  stats: Prisma.JsonValue;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: campaign.id,
    name: campaign.name,
    objective: campaign.objective,
    platform: campaign.platform,
    status: campaign.status,
    metaBusinessId: campaign.metaBusinessId,
    metaAdAccountId: campaign.metaAdAccountId,
    metaCampaignId: campaign.metaCampaignId,
    metaAdSetId: campaign.metaAdSetId,
    metaCreativeId: campaign.metaCreativeId,
    metaAdId: campaign.metaAdId,
    facebookPageId: campaign.facebookPageId,
    instagramActorId: campaign.instagramActorId,
    whatsappPhoneNumberId: campaign.whatsappPhoneNumberId,
    creativeConfig: asObject(campaign.creativeConfig),
    audienceConfig: asObject(campaign.audienceConfig),
    budgetConfig: asObject(campaign.budgetConfig),
    automationConfig: asObject(campaign.automationConfig),
    trackingConfig: asObject(campaign.trackingConfig),
    stats: statsFrom(campaign.stats),
    errorMessage: campaign.errorMessage,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    adsManagerUrl: campaign.metaAdId ? `${ADS_MANAGER_URL}?act=${encodeURIComponent((campaign.metaAdAccountId || "").replace(/^act_/, ""))}` : ADS_MANAGER_URL
  };
}

async function integrationSnapshot(tenantId: string) {
  const [metaAds, whatsApp] = await Promise.all([
    companyIntegrationService.getCompanyIntegration(tenantId, "META_ADS"),
    companyIntegrationService.getCompanyIntegration(tenantId, "WHATSAPP_CLOUD")
  ]);

  const metaDisplay = asObject(metaAds.maskedDisplay);
  const whatsAppDisplay = asObject(whatsApp.maskedDisplay);
  const metadata = asObject(metaAds.metadata);

  return {
    metaAds: {
      status: metaAds.status,
      connected: metaAds.status === IntegrationStatus.CONNECTED,
      adAccount: Boolean(metaDisplay.META_AD_ACCOUNT_ID || metadata.adAccountName || metadata.accountName),
      facebookPage: Boolean(metaDisplay.FACEBOOK_PAGE_ID || metadata.pageName),
      accountName: metadata.adAccountName || metadata.accountName || null,
      currency: metadata.currency || null,
      timezone: metadata.timezone || null,
      pageName: metadata.pageName || null,
      instagramUsername: metadata.instagramUsername || null,
      lastVerifiedAt: metaAds.lastVerifiedAt || metadata.lastVerifiedAt || null
    },
    whatsApp: {
      status: whatsApp.status,
      connected: whatsApp.status === IntegrationStatus.CONNECTED,
      phoneNumberIdSaved: Boolean(whatsAppDisplay.WHATSAPP_PHONE_NUMBER_ID),
      displayPhoneNumber: asObject(whatsApp.metadata).displayPhoneNumber || null
    },
    facebookPage: {
      connected: metaAds.status === IntegrationStatus.CONNECTED && Boolean(metaDisplay.FACEBOOK_PAGE_ID || metadata.pageName),
      name: metadata.pageName || null
    },
    adAccount: {
      connected: metaAds.status === IntegrationStatus.CONNECTED && Boolean(metaDisplay.META_AD_ACCOUNT_ID || metadata.adAccountName || metadata.accountName),
      name: metadata.adAccountName || metadata.accountName || null
    },
    adsManagerUrl: ADS_MANAGER_URL
  };
}

async function logSync(input: {
  tenantId: string;
  adCampaignId?: string | null;
  action: string;
  status: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  errorMessage?: string | null;
}) {
  await prisma.adSyncLog.create({
    data: {
      tenantId: input.tenantId,
      adCampaignId: input.adCampaignId ?? null,
      action: input.action,
      status: input.status,
      requestPayload: asJson(scrubSecretsFromLogs(input.requestPayload ?? {})),
      responsePayload: asJson(scrubSecretsFromLogs(input.responsePayload ?? {})),
      errorMessage: input.errorMessage ?? null
    }
  }).catch((error) => logger.warn({ error, action: input.action }, "Ad sync log skipped"));
}

function integrationMissing(message: string) {
  return new AppError(message, 400, {
    ok: false,
    code: "INTEGRATION_NOT_CONNECTED",
    message
  });
}

async function requireMetaAds(tenantId: string) {
  try {
    return await companyIntegrationService.metaAds(tenantId);
  } catch {
    throw integrationMissing("Connect Meta Ads integration to publish.");
  }
}

async function requireWhatsApp(tenantId: string) {
  try {
    return await companyIntegrationService.whatsApp(tenantId);
  } catch {
    throw integrationMissing("WhatsApp Cloud API is required for Click-to-WhatsApp ads.");
  }
}

async function metaPost(tenantId: string, credentials: MetaAdsCredentials, path: string, payload: Record<string, unknown>) {
  const url = new URL(`https://graph.facebook.com/v20.0${path}`);
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null || value === "") continue;
    body.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
      body,
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;

    void apiUsageService.log({
      companyId: tenantId,
      provider: "META_ADS",
      endpoint: path,
      method: "POST",
      statusCode: response.status,
      success: response.ok,
      metadata: {
        action: "ads_publish",
        error: (data as { error?: { message?: string } }).error?.message
      }
    });

    if (!response.ok) {
      throw new AppError((data as { error?: { message?: string } }).error?.message || `Meta Ads API returned HTTP ${response.status}.`, 400);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function metaGet(tenantId: string, credentials: MetaAdsCredentials, path: string, params: Record<string, string> = {}) {
  const url = new URL(`https://graph.facebook.com/v20.0${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
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
      metadata: { action: "ads_insights", fields: params.fields }
    });
    if (!response.ok) throw new AppError((data as { error?: { message?: string } }).error?.message || "Meta Ads insights sync failed.", 400);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function adBudgetMinorUnits(budgetConfig: Record<string, unknown>) {
  const daily = numberValue(budgetConfig.dailyBudget, 0);
  const lifetime = numberValue(budgetConfig.lifetimeBudget, 0);
  return {
    dailyBudget: daily > 0 ? Math.round(daily * 100) : null,
    lifetimeBudget: lifetime > 0 ? Math.round(lifetime * 100) : null
  };
}

function extractReferral(rawPayload: unknown) {
  const message = asObject(rawPayload);
  const referral = asObject(message.referral);
  const metaAdId = clean(referral.ad_id || referral.source_id || referral.id);
  if (!metaAdId) return null;

  return {
    metaAdId,
    sourceUrl: clean(referral.source_url) || null,
    headline: clean(referral.headline) || null,
    body: clean(referral.body) || null
  };
}

export const adCampaignService = {
  async dashboard(tenantId: string) {
    const [campaigns, connections, leadCounts, ordersGenerated, humanQueueFromAds] = await Promise.all([
      prisma.adCampaign.findMany({ where: { tenantId }, orderBy: { updatedAt: "desc" } }),
      integrationSnapshot(tenantId),
      prisma.lead.groupBy({
        by: ["leadTemperature"],
        where: { companyId: tenantId, source: "META_AD" },
        _count: { _all: true }
      }),
      prisma.orderSummary.count({ where: { lead: { companyId: tenantId, source: "META_AD" } } }),
      prisma.lead.count({ where: { companyId: tenantId, source: "META_AD", humanTakeoverRequired: true, humanResolvedAt: null } })
    ]);

    const totals = campaigns.reduce((sum, campaign) => {
      const stats = statsFrom(campaign.stats);
      sum.conversationsStarted += numberValue(stats.conversationsStarted);
      sum.leadsGenerated += numberValue(stats.leadsGenerated);
      return sum;
    }, { conversationsStarted: 0, leadsGenerated: 0 });

    const temperatureCounts = Object.fromEntries(
      leadCounts.map((row) => [row.leadTemperature, row._count._all])
    ) as Partial<Record<LeadTemperature, number>>;

    return {
      connection: connections,
      metrics: {
        activeAds: campaigns.filter((campaign) => ["PUBLISHING", "RUNNING", "MANUALLY_LAUNCHED"].includes(campaign.status)).length,
        draftAds: campaigns.filter((campaign) => ["DRAFT", "READY_TO_PUBLISH"].includes(campaign.status)).length,
        conversationsStarted: totals.conversationsStarted,
        leadsGenerated: totals.leadsGenerated,
        hotLeads: temperatureCounts.HOT ?? 0,
        warmLeads: temperatureCounts.WARM ?? 0,
        scrapLeads: temperatureCounts.SCRAP ?? 0,
        ordersGenerated,
        humanQueueFromAds,
        spend: null,
        costPerConversation: null,
        insightsMessage: INSIGHTS_PLACEHOLDER
      },
      campaigns: campaigns.map(publicCampaign)
    };
  },

  async create(tenantId: string, actorUserId: string | null, input: AdCampaignInput) {
    const creativeConfig = asObject(input.creativeConfig);
    const record = await prisma.adCampaign.create({
      data: {
        tenantId,
        name: clean(input.name) || clean(creativeConfig.adName) || "Untitled Click-to-WhatsApp Ad",
        objective: clean(input.objective) || "CLICK_TO_WHATSAPP",
        platform: clean(input.platform) || "FACEBOOK_INSTAGRAM",
        status: input.status || "DRAFT",
        creativeConfig: asJson(input.creativeConfig),
        audienceConfig: asJson(input.audienceConfig),
        budgetConfig: asJson(input.budgetConfig),
        automationConfig: asJson(input.automationConfig),
        trackingConfig: asJson(input.trackingConfig),
        stats: asJson(defaultStats()),
        createdById: actorUserId,
        updatedById: actorUserId
      }
    });
    await logSync({ tenantId, adCampaignId: record.id, action: "ad.created", status: record.status });
    return publicCampaign(record);
  },

  async get(tenantId: string, id: string) {
    const campaign = await prisma.adCampaign.findFirst({ where: { id, tenantId } });
    if (!campaign) throw new AppError("Ad campaign not found.", 404);
    return publicCampaign(campaign);
  },

  async update(tenantId: string, id: string, actorUserId: string | null, input: AdCampaignInput) {
    await this.get(tenantId, id);
    const data: Prisma.AdCampaignUpdateInput = {
      updatedById: actorUserId
    };
    if (input.name !== undefined) data.name = clean(input.name) || "Untitled Click-to-WhatsApp Ad";
    if (input.objective !== undefined) data.objective = clean(input.objective) || "CLICK_TO_WHATSAPP";
    if (input.platform !== undefined) data.platform = clean(input.platform) || "FACEBOOK_INSTAGRAM";
    if (input.status !== undefined) data.status = input.status;
    if (input.creativeConfig !== undefined) data.creativeConfig = asJson(input.creativeConfig);
    if (input.audienceConfig !== undefined) data.audienceConfig = asJson(input.audienceConfig);
    if (input.budgetConfig !== undefined) data.budgetConfig = asJson(input.budgetConfig);
    if (input.automationConfig !== undefined) data.automationConfig = asJson(input.automationConfig);
    if (input.trackingConfig !== undefined) data.trackingConfig = asJson(input.trackingConfig);

    const campaign = await prisma.adCampaign.update({ where: { id }, data });
    await logSync({ tenantId, adCampaignId: id, action: "ad.updated", status: campaign.status });
    return publicCampaign(campaign);
  },

  async launch(tenantId: string, id: string, actorUserId: string | null) {
    const campaign = await prisma.adCampaign.findFirst({ where: { id, tenantId } });
    if (!campaign) throw new AppError("Ad campaign not found.", 404);
    if (campaign.objective !== "CLICK_TO_WHATSAPP") {
      throw new AppError("Only Click-to-WhatsApp ads can be launched from CRM OS right now.", 400);
    }

    const metaAds = await requireMetaAds(tenantId);
    const whatsApp = await requireWhatsApp(tenantId);
    const verification = await metaAdsVerificationService.verifyMetaAdsIntegration(tenantId, {
      META_ADS_ACCESS_TOKEN: metaAds.accessToken,
      META_AD_ACCOUNT_ID: metaAds.adAccountId,
      FACEBOOK_PAGE_ID: metaAds.facebookPageId,
      META_BUSINESS_ID: metaAds.metaBusinessId,
      INSTAGRAM_ACTOR_ID: metaAds.instagramActorId,
      META_PIXEL_ID: metaAds.metaPixelId
    });
    if (verification.status !== IntegrationStatus.CONNECTED) {
      await prisma.adCampaign.update({
        where: { id },
        data: { status: "FAILED", errorMessage: verification.message, updatedById: actorUserId }
      });
      throw new AppError(verification.message, 400, { code: "META_ADS_VERIFY_FAILED", message: verification.message });
    }

    await prisma.adCampaign.update({
      where: { id },
      data: { status: "PUBLISHING", errorMessage: null, updatedById: actorUserId }
    });

    const creative = asObject(campaign.creativeConfig);
    const audience = asObject(campaign.audienceConfig);
    const budget = asObject(campaign.budgetConfig);
    const automation = asObject(campaign.automationConfig);
    const normalizedAdAccountId = normalizeMetaAdAccountId(metaAds.adAccountId);
    const budgetUnits = adBudgetMinorUnits(budget);
    const campaignPayload = {
      name: campaign.name,
      objective: "OUTCOME_ENGAGEMENT",
      status: "PAUSED",
      special_ad_categories: []
    };

    try {
      const metaCampaign = await metaPost(tenantId, metaAds, `/${normalizedAdAccountId}/campaigns`, campaignPayload);
      const campaignId = clean(metaCampaign.id);
      const adSetPayload = {
        name: `${campaign.name} Ad Set`,
        campaign_id: campaignId,
        billing_event: "IMPRESSIONS",
        optimization_goal: "CONVERSATIONS",
        destination_type: "WHATSAPP",
        status: "PAUSED",
        daily_budget: budgetUnits.dailyBudget,
        lifetime_budget: budgetUnits.lifetimeBudget,
        start_time: clean(budget.startDate) || undefined,
        end_time: clean(budget.endDate) || undefined,
        promoted_object: {
          page_id: metaAds.facebookPageId,
          whatsapp_phone_number_id: whatsApp.phoneNumberId
        },
        targeting: {
          geo_locations: { countries: [clean(audience.country) || "IN"] },
          publisher_platforms: campaign.platform === "INSTAGRAM" ? ["instagram"] : campaign.platform === "FACEBOOK" ? ["facebook"] : ["facebook", "instagram"]
        }
      };
      const metaAdSet = await metaPost(tenantId, metaAds, `/${normalizedAdAccountId}/adsets`, adSetPayload);
      const adSetId = clean(metaAdSet.id);
      const creativePayload = {
        name: `${campaign.name} Creative`,
        object_story_spec: {
          page_id: metaAds.facebookPageId,
          instagram_actor_id: metaAds.instagramActorId || undefined,
          link_data: {
            message: clean(creative.primaryText) || "Message us on WhatsApp.",
            name: clean(creative.headline) || campaign.name,
            description: clean(creative.description) || "Start a WhatsApp conversation with our team.",
            call_to_action: {
              type: "WHATSAPP_MESSAGE",
              value: {
                app_destination: "WHATSAPP",
                whatsapp_number: clean(automation.whatsappNumber) || whatsApp.phoneNumberId
              }
            }
          }
        }
      };
      const metaCreative = await metaPost(tenantId, metaAds, `/${normalizedAdAccountId}/adcreatives`, creativePayload);
      const creativeId = clean(metaCreative.id);
      const metaAd = await metaPost(tenantId, metaAds, `/${normalizedAdAccountId}/ads`, {
        name: campaign.name,
        adset_id: adSetId,
        creative: { creative_id: creativeId },
        status: "ACTIVE"
      });
      const metaAdId = clean(metaAd.id);

      const updated = await prisma.adCampaign.update({
        where: { id },
        data: {
          status: "RUNNING",
          metaAdAccountId: normalizedAdAccountId,
          metaBusinessId: metaAds.metaBusinessId ?? null,
          facebookPageId: metaAds.facebookPageId,
          instagramActorId: metaAds.instagramActorId ?? null,
          whatsappPhoneNumberId: whatsApp.phoneNumberId,
          metaCampaignId: campaignId || null,
          metaAdSetId: adSetId || null,
          metaCreativeId: creativeId || null,
          metaAdId: metaAdId || null,
          errorMessage: null,
          updatedById: actorUserId
        }
      });
      await logSync({
        tenantId,
        adCampaignId: id,
        action: "ad.launched",
        status: "RUNNING",
        requestPayload: { campaignPayload, adSetPayload, creativePayload },
        responsePayload: { metaCampaign, metaAdSet, metaCreative, metaAd }
      });

      return publicCampaign(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Meta Ads publish failed.";
      const failed = await prisma.adCampaign.update({
        where: { id },
        data: { status: "FAILED", errorMessage: message, updatedById: actorUserId }
      });
      await logSync({ tenantId, adCampaignId: id, action: "ad.launch_failed", status: "FAILED", errorMessage: message });
      throw new AppError(message, 400);
    }
  },

  async markManuallyLaunched(tenantId: string, id: string, actorUserId: string | null, input: ManualLaunchInput) {
    const metaAdId = clean(input.metaAdId);
    if (!metaAdId) throw new AppError("Meta Ad ID is required.", 400);
    await this.get(tenantId, id);
    const campaign = await prisma.adCampaign.update({
      where: { id },
      data: {
        status: "MANUALLY_LAUNCHED",
        metaAdId,
        metaCampaignId: clean(input.metaCampaignId) || undefined,
        metaAdSetId: clean(input.metaAdSetId) || undefined,
        trackingConfig: asJson({ launchUrl: clean(input.launchUrl) || null, manualMappingAt: new Date().toISOString() }),
        errorMessage: null,
        updatedById: actorUserId
      }
    });
    await logSync({ tenantId, adCampaignId: id, action: "ad.manually_launched", status: "MANUALLY_LAUNCHED", requestPayload: { metaAdId } });
    return publicCampaign(campaign);
  },

  async changeStatus(tenantId: string, id: string, actorUserId: string | null, status: AdStatus, action: string) {
    await this.get(tenantId, id);
    const campaign = await prisma.adCampaign.update({
      where: { id },
      data: { status, updatedById: actorUserId }
    });
    await logSync({ tenantId, adCampaignId: id, action, status });
    return publicCampaign(campaign);
  },

  async analytics(tenantId: string, id: string) {
    const campaign = await prisma.adCampaign.findFirst({
      where: { id, tenantId },
      include: { events: true }
    });
    if (!campaign) throw new AppError("Ad campaign not found.", 404);
    return {
      campaign: publicCampaign(campaign),
      analytics: statsFrom(campaign.stats),
      events: campaign.events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        metaAdId: event.metaAdId,
        leadId: event.leadId,
        createdAt: event.createdAt,
        metadata: asObject(event.metadata)
      })),
      insightsMessage: INSIGHTS_PLACEHOLDER
    };
  },

  async syncInsights(tenantId: string, id: string, actorUserId: string | null) {
    const campaign = await prisma.adCampaign.findFirst({ where: { id, tenantId } });
    if (!campaign) throw new AppError("Ad campaign not found.", 404);
    if (!campaign.metaAdId) {
      await logSync({ tenantId, adCampaignId: id, action: "ad.insights_skipped", status: "SKIPPED", errorMessage: "Meta Ad ID missing." });
      return { campaign: publicCampaign(campaign), message: INSIGHTS_PLACEHOLDER };
    }

    const credentials = await requireMetaAds(tenantId);
    try {
      const insights = await metaGet(tenantId, credentials, `/${campaign.metaAdId}/insights`, {
        fields: "impressions,reach,clicks,spend,cpc,cpm,ctr",
        date_preset: "maximum"
      });
      const row = ((insights.data as unknown[]) || [])[0] as Record<string, unknown> | undefined;
      const nextStats = {
        ...statsFrom(campaign.stats),
        impressions: row?.impressions ?? null,
        reach: row?.reach ?? null,
        clicks: row?.clicks ?? null,
        spend: row?.spend ?? null,
        cpc: row?.cpc ?? null,
        cpm: row?.cpm ?? null,
        ctr: row?.ctr ?? null,
        insightsMessage: null,
        insightsSyncedAt: new Date().toISOString()
      };
      const updated = await prisma.adCampaign.update({
        where: { id },
        data: { stats: asJson(nextStats), updatedById: actorUserId }
      });
      await logSync({ tenantId, adCampaignId: id, action: "ad.insights_synced", status: "CONNECTED", responsePayload: insights });
      return { campaign: publicCampaign(updated), message: "Insights synced." };
    } catch (error) {
      const message = error instanceof Error ? error.message : INSIGHTS_PLACEHOLDER;
      await logSync({ tenantId, adCampaignId: id, action: "ad.insights_failed", status: "FAILED", errorMessage: message });
      return { campaign: publicCampaign(campaign), message: INSIGHTS_PLACEHOLDER };
    }
  },

  async attributeInboundMessage(input: {
    tenantId: string;
    leadId: string;
    whatsappMessageId?: string | null;
    rawPayload?: unknown;
  }) {
    const referral = extractReferral(input.rawPayload);
    if (!referral) return null;

    const campaign = await prisma.adCampaign.findFirst({
      where: {
        tenantId: input.tenantId,
        metaAdId: referral.metaAdId
      }
    });
    if (!campaign) return null;

    const metadata = {
      whatsappMessageId: input.whatsappMessageId ?? null,
      sourceUrl: referral.sourceUrl,
      headline: referral.headline,
      body: referral.body
    };

    const existing = await prisma.adEvent.findUnique({
      where: {
        adCampaignId_eventType_leadId: {
          adCampaignId: campaign.id,
          eventType: "CONVERSATION_STARTED",
          leadId: input.leadId
        }
      }
    });

    if (existing) {
      await prisma.adEvent.update({
        where: { id: existing.id },
        data: { metadata: asJson({ ...asObject(existing.metadata), ...metadata }) }
      });
    } else {
      await prisma.adEvent.create({
        data: {
          tenantId: input.tenantId,
          adCampaignId: campaign.id,
          leadId: input.leadId,
          contactId: input.leadId,
          conversationId: input.leadId,
          metaAdId: referral.metaAdId,
          eventType: "CONVERSATION_STARTED",
          metadata: asJson(metadata)
        }
      });
      const nextStats = statsFrom(campaign.stats);
      nextStats.conversationsStarted = numberValue(nextStats.conversationsStarted) + 1;
      nextStats.leadsGenerated = numberValue(nextStats.leadsGenerated) + 1;
      await prisma.adCampaign.update({
        where: { id: campaign.id },
        data: { stats: asJson(nextStats) }
      });
    }

    await prisma.lead.update({
      where: { id: input.leadId },
      data: { source: "META_AD" }
    });

    return { adCampaignId: campaign.id, metaAdId: referral.metaAdId };
  }
};
