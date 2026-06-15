import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export type FeatureKey =
  | "overview"
  | "chats"
  | "contacts"
  | "campaigns"
  | "ads"
  | "flows"
  | "human"
  | "orders"
  | "reports"
  | "settings";

export type FeatureFlag = {
  key: FeatureKey;
  label: string;
  enabled: boolean;
};

export const DEFAULT_FEATURES: FeatureFlag[] = [
  { key: "overview", label: "Dashboard", enabled: true },
  { key: "chats", label: "Chats", enabled: true },
  { key: "contacts", label: "Contacts & Broadcasts", enabled: true },
  { key: "campaigns", label: "Campaigns", enabled: true },
  { key: "ads", label: "Ads", enabled: true },
  { key: "flows", label: "AI Flows", enabled: true },
  { key: "human", label: "Human Queue", enabled: true },
  { key: "orders", label: "Orders", enabled: true },
  { key: "reports", label: "Reports", enabled: true },
  { key: "settings", label: "Settings", enabled: true }
];

const featureKeys = new Set(DEFAULT_FEATURES.map((feature) => feature.key));
let ensuredAt = 0;

async function ensureFeatureFlagTable() {
  if (Date.now() - ensuredAt < 30000) return;

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "FeatureFlag" (
      "key" TEXT NOT NULL,
      "label" TEXT NOT NULL,
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
    )
  `);

  for (const feature of DEFAULT_FEATURES) {
    await prisma.$executeRaw`
      INSERT INTO "FeatureFlag" ("key", "label", "enabled", "updatedAt")
      VALUES (${feature.key}, ${feature.label}, ${feature.enabled}, CURRENT_TIMESTAMP)
      ON CONFLICT ("key") DO UPDATE
      SET "label" = EXCLUDED."label"
    `;
  }

  ensuredAt = Date.now();
}

function normalizeRows(rows: Array<{ key: string; label: string; enabled: boolean }>): FeatureFlag[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return DEFAULT_FEATURES.map((feature) => {
    const row = byKey.get(feature.key);
    return {
      key: feature.key,
      label: row?.label || feature.label,
      enabled: row?.enabled ?? feature.enabled
    };
  });
}

export const featureFlagService = {
  defaults: DEFAULT_FEATURES,

  async list() {
    try {
      await ensureFeatureFlagTable();
      const rows = await prisma.$queryRaw<Array<{ key: string; label: string; enabled: boolean }>>`
        SELECT "key", "label", "enabled"
        FROM "FeatureFlag"
        ORDER BY "createdAt" ASC
      `;
      return normalizeRows(rows);
    } catch (error) {
      logger.error({ error }, "Feature flag lookup failed");
      return DEFAULT_FEATURES;
    }
  },

  async enabledForUser() {
    return (await this.list()).filter((feature) => feature.enabled);
  },

  async isEnabled(key: string) {
    if (!featureKeys.has(key as FeatureKey)) return true;
    const features = await this.list();
    return Boolean(features.find((feature) => feature.key === key)?.enabled);
  },

  async update(key: string, enabled: boolean) {
    if (!featureKeys.has(key as FeatureKey)) {
      throw new AppError("Unknown feature flag", 404);
    }

    await ensureFeatureFlagTable();
    const label = DEFAULT_FEATURES.find((feature) => feature.key === key)?.label || key;
    const rows = await prisma.$queryRaw<Array<{ key: string; label: string; enabled: boolean }>>`
      INSERT INTO "FeatureFlag" ("key", "label", "enabled", "updatedAt")
      VALUES (${key}, ${label}, ${enabled}, CURRENT_TIMESTAMP)
      ON CONFLICT ("key") DO UPDATE
      SET "enabled" = EXCLUDED."enabled",
          "label" = EXCLUDED."label",
          "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "key", "label", "enabled"
    `;

    const row = rows[0];
    return row ? { key: row.key as FeatureKey, label: row.label, enabled: row.enabled } : { key: key as FeatureKey, label, enabled };
  }
};
