DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IntegrationStatus') THEN
    CREATE TYPE "IntegrationStatus" AS ENUM ('CONNECTED', 'NOT_CONNECTED', 'ERROR', 'PARTIALLY_CONNECTED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IntegrationType') THEN
    CREATE TYPE "IntegrationType" AS ENUM (
      'GOOGLE_SHEETS',
      'WHATSAPP_CLOUD',
      'WHATSAPP_TEMPLATE_SETTINGS',
      'META_ADS',
      'KNOWLEDGE_BASE',
      'AI_MODEL'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Integration" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "type" "IntegrationType" NOT NULL,
  "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
  "encryptedConfig" TEXT,
  "maskedDisplay" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "lastVerifiedAt" TIMESTAMP(3),
  "lastVerificationError" TEXT,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "IntegrationAudit" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "integrationId" TEXT,
  "type" "IntegrationType",
  "action" TEXT NOT NULL,
  "actorUserId" TEXT,
  "status" "IntegrationStatus",
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntegrationAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Integration_companyId_type_key" ON "Integration"("companyId", "type");
CREATE INDEX IF NOT EXISTS "Integration_companyId_idx" ON "Integration"("companyId");
CREATE INDEX IF NOT EXISTS "Integration_type_status_idx" ON "Integration"("type", "status");
CREATE INDEX IF NOT EXISTS "IntegrationAudit_companyId_createdAt_idx" ON "IntegrationAudit"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "IntegrationAudit_integrationId_idx" ON "IntegrationAudit"("integrationId");
CREATE INDEX IF NOT EXISTS "IntegrationAudit_type_idx" ON "IntegrationAudit"("type");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Integration_companyId_fkey'
  ) THEN
    ALTER TABLE "Integration"
      ADD CONSTRAINT "Integration_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'IntegrationAudit_companyId_fkey'
  ) THEN
    ALTER TABLE "IntegrationAudit"
      ADD CONSTRAINT "IntegrationAudit_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'IntegrationAudit_integrationId_fkey'
  ) THEN
    ALTER TABLE "IntegrationAudit"
      ADD CONSTRAINT "IntegrationAudit_integrationId_fkey"
      FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
