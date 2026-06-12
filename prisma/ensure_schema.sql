DO $$ BEGIN
  CREATE TYPE "LeadStatus" AS ENUM ('new', 'messaged', 'replied', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LeadTemperature" AS ENUM ('hot', 'warm', 'scrap');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MessageDirection" AS ENUM ('inbound', 'outbound');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MessageType" AS ENUM ('text', 'template', 'image', 'video', 'document', 'audio');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MessageStatus" AS ENUM ('pending', 'sent', 'delivered', 'read', 'failed', 'received');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "KnowledgeSourceType" AS ENUM ('manual', 'website', 'upload', 'seed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Lead" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "status" "LeadStatus" NOT NULL DEFAULT 'new',
  "source" TEXT NOT NULL DEFAULT 'google_sheets',
  "messageCount" INTEGER NOT NULL DEFAULT 0,
  "leadTemperature" "LeadTemperature" NOT NULL DEFAULT 'scrap',
  "temperatureReason" TEXT NOT NULL DEFAULT '0-1 messages',
  "googleSheetRowNumber" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Message" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "whatsappMessageId" TEXT,
  "direction" "MessageDirection" NOT NULL,
  "type" "MessageType" NOT NULL,
  "content" TEXT NOT NULL,
  "status" "MessageStatus" NOT NULL,
  "rawPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "KnowledgeBase" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "sourceType" "KnowledgeSourceType" NOT NULL DEFAULT 'manual',
  "sourceUrl" TEXT,
  "sourceName" TEXT,
  "sourceKey" TEXT,
  "chunkIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SendLog" (
  "id" TEXT NOT NULL,
  "leadId" TEXT,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SendLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "KnowledgeBase" ADD COLUMN IF NOT EXISTS "sourceType" "KnowledgeSourceType" NOT NULL DEFAULT 'manual';
ALTER TABLE "KnowledgeBase" ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT;
ALTER TABLE "KnowledgeBase" ADD COLUMN IF NOT EXISTS "sourceName" TEXT;
ALTER TABLE "KnowledgeBase" ADD COLUMN IF NOT EXISTS "sourceKey" TEXT;
ALTER TABLE "KnowledgeBase" ADD COLUMN IF NOT EXISTS "chunkIndex" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "temperatureReason" TEXT NOT NULL DEFAULT '0-1 messages';

CREATE UNIQUE INDEX IF NOT EXISTS "Lead_phone_key" ON "Lead"("phone");
CREATE UNIQUE INDEX IF NOT EXISTS "Lead_googleSheetRowNumber_key" ON "Lead"("googleSheetRowNumber");
CREATE INDEX IF NOT EXISTS "Lead_status_idx" ON "Lead"("status");
CREATE INDEX IF NOT EXISTS "Lead_leadTemperature_idx" ON "Lead"("leadTemperature");
CREATE UNIQUE INDEX IF NOT EXISTS "Message_whatsappMessageId_key" ON "Message"("whatsappMessageId");
CREATE INDEX IF NOT EXISTS "Message_leadId_createdAt_idx" ON "Message"("leadId", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_status_idx" ON "Message"("status");
CREATE INDEX IF NOT EXISTS "KnowledgeBase_category_idx" ON "KnowledgeBase"("category");
CREATE INDEX IF NOT EXISTS "KnowledgeBase_sourceType_idx" ON "KnowledgeBase"("sourceType");
CREATE INDEX IF NOT EXISTS "KnowledgeBase_sourceKey_idx" ON "KnowledgeBase"("sourceKey");
CREATE INDEX IF NOT EXISTS "SendLog_leadId_idx" ON "SendLog"("leadId");
CREATE INDEX IF NOT EXISTS "SendLog_action_status_idx" ON "SendLog"("action", "status");

DO $$ BEGIN
  ALTER TABLE "Message"
  ADD CONSTRAINT "Message_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SendLog"
  ADD CONSTRAINT "SendLog_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
