-- CreateTable
CREATE TABLE IF NOT EXISTS "FeatureFlag" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

-- Seed default feature flags
INSERT INTO "FeatureFlag" ("key", "label", "enabled", "updatedAt")
VALUES
    ('overview', 'Dashboard', true, CURRENT_TIMESTAMP),
    ('chats', 'Chats', true, CURRENT_TIMESTAMP),
    ('contacts', 'Contacts & Broadcasts', true, CURRENT_TIMESTAMP),
    ('campaigns', 'Campaigns', true, CURRENT_TIMESTAMP),
    ('ads', 'Ads', true, CURRENT_TIMESTAMP),
    ('flows', 'AI Flows', true, CURRENT_TIMESTAMP),
    ('human', 'Human Queue', true, CURRENT_TIMESTAMP),
    ('orders', 'Orders', true, CURRENT_TIMESTAMP),
    ('reports', 'Reports', true, CURRENT_TIMESTAMP),
    ('settings', 'Settings', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE
SET "label" = EXCLUDED."label";
