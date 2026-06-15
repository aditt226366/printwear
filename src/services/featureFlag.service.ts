import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export type FeatureKey =
  | "dashboard"
  | "chats"
  | "contacts_broadcasts"
  | "campaigns"
  | "ads"
  | "ai_flows"
  | "human_queue"
  | "orders"
  | "reports"
  | "settings";

export type FeatureFlag = {
  id?: string;
  key: FeatureKey;
  label: string;
  description: string;
  enabled: boolean;
};

export const DEFAULT_FEATURES: FeatureFlag[] = [
  { key: "dashboard", label: "Dashboard", description: "Command metrics, import leads, and welcome sends.", enabled: true },
  { key: "chats", label: "Chats", description: "Live WhatsApp conversations and manual replies.", enabled: true },
  { key: "contacts_broadcasts", label: "Contacts & Broadcasts", description: "Audience imports, contact management, and broadcasts.", enabled: true },
  { key: "campaigns", label: "Campaigns", description: "Scheduled WhatsApp outreach and campaign reporting.", enabled: true },
  { key: "ads", label: "Ads", description: "Click-to-WhatsApp ad drafts and Meta status checks.", enabled: true },
  { key: "ai_flows", label: "AI Flows", description: "Workflow builder, triggers, and automation logs.", enabled: true },
  { key: "human_queue", label: "Human Queue", description: "Manual takeover queue and priority follow-ups.", enabled: true },
  { key: "orders", label: "Orders", description: "Order summaries, dispatch status, and customer updates.", enabled: true },
  { key: "reports", label: "Reports", description: "Performance dashboards and CRM analytics.", enabled: true },
  { key: "settings", label: "Settings", description: "Account/session controls and workspace settings.", enabled: true }
];

const featureKeys = new Set(DEFAULT_FEATURES.map((feature) => feature.key));

function normalizeRows(rows: Array<{ id: string; featureKey: string; featureName: string; enabled: boolean }>): FeatureFlag[] {
  const byKey = new Map(rows.map((row) => [row.featureKey, row]));
  return DEFAULT_FEATURES.map((feature) => {
    const row = byKey.get(feature.key);
    return {
      id: row?.id,
      key: feature.key,
      label: row?.featureName || feature.label,
      description: feature.description,
      enabled: row?.enabled ?? feature.enabled
    };
  });
}

export const featureFlagService = {
  defaults: DEFAULT_FEATURES,

  async ensureDefaultsForCompany(companyId: string) {
    for (const feature of DEFAULT_FEATURES) {
      await prisma.companyFeature.upsert({
        where: { companyId_featureKey: { companyId, featureKey: feature.key } },
        update: { featureName: feature.label },
        create: {
          companyId,
          featureKey: feature.key,
          featureName: feature.label,
          enabled: feature.enabled
        }
      });
    }
  },

  async list(companyId?: string | null) {
    if (!companyId) return DEFAULT_FEATURES;
    try {
      await this.ensureDefaultsForCompany(companyId);
      const rows = await prisma.companyFeature.findMany({
        where: { companyId },
        orderBy: { createdAt: "asc" }
      });
      return normalizeRows(rows);
    } catch (error) {
      logger.error({ error, companyId }, "Feature flag lookup failed");
      throw new AppError("Feature access unavailable. Please try again.", 503);
    }
  },

  async enabledForUser(companyId?: string | null) {
    return (await this.list(companyId)).filter((feature) => feature.enabled);
  },

  async isEnabled(key: string, companyId?: string | null) {
    if (!featureKeys.has(key as FeatureKey)) return true;
    if (!companyId) return false;
    const features = await this.list(companyId);
    return Boolean(features.find((feature) => feature.key === key)?.enabled);
  },

  async update(featureId: string, enabled: boolean) {
    const feature = await prisma.companyFeature.findUnique({ where: { id: featureId } });
    if (!feature) throw new AppError("Unknown feature flag", 404);
    if (!featureKeys.has(feature.featureKey as FeatureKey)) throw new AppError("Unknown feature flag", 404);

    const updated = await prisma.companyFeature.update({
      where: { id: featureId },
      data: { enabled }
    });
    const defaults = DEFAULT_FEATURES.find((item) => item.key === updated.featureKey);
    return {
      id: updated.id,
      key: updated.featureKey as FeatureKey,
      label: updated.featureName,
      description: defaults?.description || "",
      enabled: updated.enabled
    };
  }
};
