import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export type FeatureKey =
  | "dashboard"
  | "chats"
  | "contacts"
  | "broadcasts"
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
  { key: "dashboard", label: "Command Center", description: "Conversation Pulse, Priority Queue, and Pulse Interpreter.", enabled: true },
  { key: "chats", label: "Inbox", description: "WhatsApp-style live conversation inbox with AI replies, manual replies, takeover, tags, lead status, and message history.", enabled: true },
  { key: "contacts", label: "Contacts", description: "Audience and contact management with CSV import, Google Sheets import, contact table, tags, source, lifecycle status, and segments.", enabled: true },
  { key: "broadcasts", label: "Broadcasts", description: "Bulk WhatsApp template messaging with segment selection, progress tracking, delivery/read status, and CRM chat history capture.", enabled: true },
  { key: "campaigns", label: "Campaigns", description: "Scheduled and multi-step WhatsApp outreach with audience selection, templates, run now, pause/cancel, metrics, and reply tracking.", enabled: true },
  { key: "ads", label: "Ads", description: "Facebook, Instagram, and WhatsApp click-to-chat ad planning with Meta status, drafts, objectives, audience mapping, previews, and tracking.", enabled: true },
  { key: "ai_flows", label: "AI Flows", description: "Workflow automation builder with trigger, message, condition, delay, takeover, order draft blocks, activation, tests, and logs.", enabled: true },
  { key: "human_queue", label: "Human Queue", description: "Priority human takeover inbox with handoff reason, suggested reply, priority, owner, open chat, and return-to-AI controls.", enabled: true },
  { key: "orders", label: "Orders", description: "WhatsApp-linked order operations for product, quantity, size, color, delivery location, status, and WhatsApp updates.", enabled: true },
  { key: "reports", label: "Reports", description: "Operational reporting for conversations, reply rate, campaign performance, broadcast performance, AI flows, and order movement.", enabled: true },
  { key: "settings", label: "Settings", description: "Company and user settings only.", enabled: true }
];

const featureKeys = new Set(DEFAULT_FEATURES.map((feature) => feature.key));

function normalizeRows(rows: Array<{ id: string; featureKey: string; featureName: string; enabled: boolean }>): FeatureFlag[] {
  const byKey = new Map(rows.map((row) => [row.featureKey, row]));
  return DEFAULT_FEATURES.map((feature) => {
    const row = byKey.get(feature.key);
    return {
      id: row?.id,
      key: feature.key,
      label: feature.label,
      description: feature.description,
      enabled: row?.enabled ?? feature.enabled
    };
  });
}

export const featureFlagService = {
  defaults: DEFAULT_FEATURES,

  async ensureDefaultsForCompany(companyId: string) {
    await prisma.companyFeature.createMany({
      data: DEFAULT_FEATURES.map((feature) => ({
        companyId,
        featureKey: feature.key,
        featureName: feature.label,
        enabled: feature.enabled
      })),
      skipDuplicates: true
    });
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
      label: defaults?.label || updated.featureName,
      description: defaults?.description || "",
      enabled: updated.enabled
    };
  }
};
