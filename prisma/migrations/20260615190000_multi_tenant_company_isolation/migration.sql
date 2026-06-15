-- Multi-tenant company ownership for CRM records.
-- Existing production rows are assigned to the default Printwear company.

CREATE UNIQUE INDEX IF NOT EXISTS "Company_slug_key" ON "Company"("slug");

INSERT INTO "Company" ("id", "name", "slug", "status", "createdAt", "updatedAt")
VALUES ('printwear_default_company', 'Printwear', 'printwear', 'active', NOW(), NOW())
ON CONFLICT ("slug") DO NOTHING;

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "whatsappNumber" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "brandColor" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "timezone" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "businessType" TEXT;

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
UPDATE "Lead" SET "companyId" = (SELECT "id" FROM "Company" WHERE "slug" = 'printwear' LIMIT 1) WHERE "companyId" IS NULL;
ALTER TABLE "Lead" ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "KnowledgeBase" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
UPDATE "KnowledgeBase" SET "companyId" = (SELECT "id" FROM "Company" WHERE "slug" = 'printwear' LIMIT 1) WHERE "companyId" IS NULL;
ALTER TABLE "KnowledgeBase" ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "BulkMessageJob" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
UPDATE "BulkMessageJob" SET "companyId" = (SELECT "id" FROM "Company" WHERE "slug" = 'printwear' LIMIT 1) WHERE "companyId" IS NULL;
ALTER TABLE "BulkMessageJob" ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
UPDATE "Campaign" SET "companyId" = (SELECT "id" FROM "Company" WHERE "slug" = 'printwear' LIMIT 1) WHERE "companyId" IS NULL;
ALTER TABLE "Campaign" ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "AdDraft" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
UPDATE "AdDraft" SET "companyId" = (SELECT "id" FROM "Company" WHERE "slug" = 'printwear' LIMIT 1) WHERE "companyId" IS NULL;
ALTER TABLE "AdDraft" ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "AiWorkflow" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
UPDATE "AiWorkflow" SET "companyId" = (SELECT "id" FROM "Company" WHERE "slug" = 'printwear' LIMIT 1) WHERE "companyId" IS NULL;
ALTER TABLE "AiWorkflow" ALTER COLUMN "companyId" SET NOT NULL;

DROP INDEX IF EXISTS "Lead_phone_key";
DROP INDEX IF EXISTS "Lead_googleSheetRowNumber_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Lead_companyId_phone_key" ON "Lead" ("companyId", "phone");
CREATE UNIQUE INDEX IF NOT EXISTS "Lead_companyId_googleSheetRowNumber_key" ON "Lead" ("companyId", "googleSheetRowNumber");
CREATE INDEX IF NOT EXISTS "Lead_companyId_idx" ON "Lead" ("companyId");
CREATE INDEX IF NOT EXISTS "KnowledgeBase_companyId_idx" ON "KnowledgeBase" ("companyId");
CREATE INDEX IF NOT EXISTS "BulkMessageJob_companyId_idx" ON "BulkMessageJob" ("companyId");
CREATE INDEX IF NOT EXISTS "Campaign_companyId_idx" ON "Campaign" ("companyId");
CREATE INDEX IF NOT EXISTS "AdDraft_companyId_idx" ON "AdDraft" ("companyId");
CREATE INDEX IF NOT EXISTS "AiWorkflow_companyId_idx" ON "AiWorkflow" ("companyId");

DO $$ BEGIN
  ALTER TABLE "Lead" ADD CONSTRAINT "Lead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BulkMessageJob" ADD CONSTRAINT "BulkMessageJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AdDraft" ADD CONSTRAINT "AdDraft_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AiWorkflow" ADD CONSTRAINT "AiWorkflow_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
