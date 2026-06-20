-- Tenant-scoped approved-template library for Contacts broadcasts.
CREATE TABLE "ContactBroadcastTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'MARKETING',
    "language" TEXT NOT NULL DEFAULT 'en_US',
    "body" TEXT NOT NULL,
    "headerText" TEXT,
    "footerText" TEXT,
    "metaTemplateId" TEXT,
    "metaStatus" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "rejectionReason" TEXT,
    "lastSubmittedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactBroadcastTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactBroadcastTemplate_companyId_name_language_key" ON "ContactBroadcastTemplate"("companyId", "name", "language");
CREATE INDEX "ContactBroadcastTemplate_companyId_idx" ON "ContactBroadcastTemplate"("companyId");
CREATE INDEX "ContactBroadcastTemplate_companyId_status_idx" ON "ContactBroadcastTemplate"("companyId", "status");
CREATE INDEX "ContactBroadcastTemplate_metaTemplateId_idx" ON "ContactBroadcastTemplate"("metaTemplateId");

ALTER TABLE "ContactBroadcastTemplate"
ADD CONSTRAINT "ContactBroadcastTemplate_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
