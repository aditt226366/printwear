CREATE TABLE IF NOT EXISTS "AdCampaign" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "objective" TEXT NOT NULL DEFAULT 'CLICK_TO_WHATSAPP',
  "platform" TEXT NOT NULL DEFAULT 'FACEBOOK_INSTAGRAM',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "metaBusinessId" TEXT,
  "metaAdAccountId" TEXT,
  "metaCampaignId" TEXT,
  "metaAdSetId" TEXT,
  "metaCreativeId" TEXT,
  "metaAdId" TEXT,
  "facebookPageId" TEXT,
  "instagramActorId" TEXT,
  "whatsappPhoneNumberId" TEXT,
  "creativeConfig" JSONB NOT NULL DEFAULT '{}',
  "audienceConfig" JSONB NOT NULL DEFAULT '{}',
  "budgetConfig" JSONB NOT NULL DEFAULT '{}',
  "automationConfig" JSONB NOT NULL DEFAULT '{}',
  "trackingConfig" JSONB NOT NULL DEFAULT '{}',
  "stats" JSONB NOT NULL DEFAULT '{}',
  "errorMessage" TEXT,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdAudience" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "adCampaignId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "uploadedCsvName" TEXT,
  "audienceConfig" JSONB NOT NULL DEFAULT '{}',
  "metaAudienceId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdAudience_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "adCampaignId" TEXT NOT NULL,
  "conversationId" TEXT,
  "contactId" TEXT,
  "leadId" TEXT,
  "metaAdId" TEXT,
  "eventType" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdSyncLog" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "adCampaignId" TEXT,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requestPayload" JSONB NOT NULL DEFAULT '{}',
  "responsePayload" JSONB NOT NULL DEFAULT '{}',
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdSyncLog_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdCampaign_tenantId_fkey') THEN
    ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdAudience_tenantId_fkey') THEN
    ALTER TABLE "AdAudience" ADD CONSTRAINT "AdAudience_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdAudience_adCampaignId_fkey') THEN
    ALTER TABLE "AdAudience" ADD CONSTRAINT "AdAudience_adCampaignId_fkey" FOREIGN KEY ("adCampaignId") REFERENCES "AdCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdEvent_tenantId_fkey') THEN
    ALTER TABLE "AdEvent" ADD CONSTRAINT "AdEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdEvent_adCampaignId_fkey') THEN
    ALTER TABLE "AdEvent" ADD CONSTRAINT "AdEvent_adCampaignId_fkey" FOREIGN KEY ("adCampaignId") REFERENCES "AdCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdSyncLog_tenantId_fkey') THEN
    ALTER TABLE "AdSyncLog" ADD CONSTRAINT "AdSyncLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdSyncLog_adCampaignId_fkey') THEN
    ALTER TABLE "AdSyncLog" ADD CONSTRAINT "AdSyncLog_adCampaignId_fkey" FOREIGN KEY ("adCampaignId") REFERENCES "AdCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "AdCampaign_tenantId_idx" ON "AdCampaign"("tenantId");
CREATE INDEX IF NOT EXISTS "AdCampaign_tenantId_status_idx" ON "AdCampaign"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "AdCampaign_metaAdId_idx" ON "AdCampaign"("metaAdId");
CREATE INDEX IF NOT EXISTS "AdCampaign_createdAt_idx" ON "AdCampaign"("createdAt");
CREATE INDEX IF NOT EXISTS "AdAudience_tenantId_idx" ON "AdAudience"("tenantId");
CREATE INDEX IF NOT EXISTS "AdAudience_adCampaignId_idx" ON "AdAudience"("adCampaignId");
CREATE INDEX IF NOT EXISTS "AdAudience_status_idx" ON "AdAudience"("status");
CREATE INDEX IF NOT EXISTS "AdEvent_tenantId_idx" ON "AdEvent"("tenantId");
CREATE INDEX IF NOT EXISTS "AdEvent_adCampaignId_idx" ON "AdEvent"("adCampaignId");
CREATE INDEX IF NOT EXISTS "AdEvent_metaAdId_idx" ON "AdEvent"("metaAdId");
CREATE INDEX IF NOT EXISTS "AdEvent_eventType_idx" ON "AdEvent"("eventType");
CREATE INDEX IF NOT EXISTS "AdEvent_leadId_idx" ON "AdEvent"("leadId");
CREATE UNIQUE INDEX IF NOT EXISTS "AdEvent_adCampaignId_eventType_leadId_key" ON "AdEvent"("adCampaignId", "eventType", "leadId");
CREATE INDEX IF NOT EXISTS "AdSyncLog_tenantId_idx" ON "AdSyncLog"("tenantId");
CREATE INDEX IF NOT EXISTS "AdSyncLog_adCampaignId_idx" ON "AdSyncLog"("adCampaignId");
CREATE INDEX IF NOT EXISTS "AdSyncLog_action_status_idx" ON "AdSyncLog"("action", "status");
CREATE INDEX IF NOT EXISTS "AdSyncLog_createdAt_idx" ON "AdSyncLog"("createdAt");
