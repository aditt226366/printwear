CREATE TABLE IF NOT EXISTS "CompanyIntegration" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "googleSheetsId" TEXT,
  "googleServiceAccountEmail" TEXT,
  "googlePrivateKeyEncrypted" TEXT,
  "whatsappPhoneNumberId" TEXT,
  "whatsappBusinessAccountId" TEXT,
  "whatsappAccessTokenEncrypted" TEXT,
  "whatsappVerifyToken" TEXT,
  "whatsappDefaultTemplateName" TEXT,
  "whatsappTemplateLanguage" TEXT NOT NULL DEFAULT 'en',
  "metaAdAccountId" TEXT,
  "metaAdsAccessTokenEncrypted" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyIntegration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyIntegration_companyId_key" ON "CompanyIntegration"("companyId");
CREATE INDEX IF NOT EXISTS "CompanyIntegration_whatsappPhoneNumberId_idx" ON "CompanyIntegration"("whatsappPhoneNumberId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'CompanyIntegration_companyId_fkey'
  ) THEN
    ALTER TABLE "CompanyIntegration"
      ADD CONSTRAINT "CompanyIntegration_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
