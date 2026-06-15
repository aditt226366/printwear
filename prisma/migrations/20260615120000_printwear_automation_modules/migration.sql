-- CreateEnum
CREATE TYPE "AutomationSendStatus" AS ENUM ('queued', 'sent', 'failed', 'delivered', 'read');

-- CreateEnum
CREATE TYPE "BulkJobStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'scheduled', 'running', 'completed', 'failed', 'paused', 'cancelled');

-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('whatsapp_template');

-- CreateEnum
CREATE TYPE "AdDraftStatus" AS ENUM ('draft');

-- CreateEnum
CREATE TYPE "WorkflowTriggerType" AS ENUM ('keyword', 'regex', 'template', 'ad');

-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('started', 'executed', 'failed');

-- AlterTable
ALTER TABLE "Lead"
ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "attributes" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "BulkMessageJob" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "templateLanguage" TEXT NOT NULL DEFAULT 'en_US',
    "status" "BulkJobStatus" NOT NULL DEFAULT 'queued',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkMessageJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkMessageRecipient" (
    "id" TEXT NOT NULL,
    "bulkMessageJobId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "AutomationSendStatus" NOT NULL DEFAULT 'queued',
    "whatsappMessageId" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkMessageRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CampaignType" NOT NULL DEFAULT 'whatsapp_template',
    "audience" JSONB NOT NULL,
    "templateName" TEXT NOT NULL,
    "templateLanguage" TEXT NOT NULL DEFAULT 'en_US',
    "messagePreview" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "repliesCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "AutomationSendStatus" NOT NULL DEFAULT 'queued',
    "whatsappMessageId" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdDraft" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "destinationWhatsAppNumber" TEXT NOT NULL,
    "templatePreview" TEXT NOT NULL,
    "status" "AdDraftStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiWorkflow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "triggerType" "WorkflowTriggerType" NOT NULL,
    "triggerValue" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowExecutionLog" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "leadId" TEXT,
    "status" "WorkflowRunStatus" NOT NULL,
    "stepKey" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowExecutionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_source_idx" ON "Lead"("source");

-- CreateIndex
CREATE INDEX "BulkMessageJob_status_createdAt_idx" ON "BulkMessageJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BulkMessageRecipient_bulkMessageJobId_leadId_key" ON "BulkMessageRecipient"("bulkMessageJobId", "leadId");

-- CreateIndex
CREATE INDEX "BulkMessageRecipient_status_idx" ON "BulkMessageRecipient"("status");

-- CreateIndex
CREATE INDEX "BulkMessageRecipient_whatsappMessageId_idx" ON "BulkMessageRecipient"("whatsappMessageId");

-- CreateIndex
CREATE INDEX "Campaign_status_scheduledAt_idx" ON "Campaign"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Campaign_createdAt_idx" ON "Campaign"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_leadId_key" ON "CampaignRecipient"("campaignId", "leadId");

-- CreateIndex
CREATE INDEX "CampaignRecipient_status_idx" ON "CampaignRecipient"("status");

-- CreateIndex
CREATE INDEX "CampaignRecipient_whatsappMessageId_idx" ON "CampaignRecipient"("whatsappMessageId");

-- CreateIndex
CREATE INDEX "AdDraft_createdAt_idx" ON "AdDraft"("createdAt");

-- CreateIndex
CREATE INDEX "AiWorkflow_isActive_triggerType_idx" ON "AiWorkflow"("isActive", "triggerType");

-- CreateIndex
CREATE INDEX "WorkflowExecutionLog_workflowId_createdAt_idx" ON "WorkflowExecutionLog"("workflowId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowExecutionLog_leadId_idx" ON "WorkflowExecutionLog"("leadId");

-- AddForeignKey
ALTER TABLE "BulkMessageRecipient" ADD CONSTRAINT "BulkMessageRecipient_bulkMessageJobId_fkey" FOREIGN KEY ("bulkMessageJobId") REFERENCES "BulkMessageJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkMessageRecipient" ADD CONSTRAINT "BulkMessageRecipient_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExecutionLog" ADD CONSTRAINT "WorkflowExecutionLog_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "AiWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowExecutionLog" ADD CONSTRAINT "WorkflowExecutionLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
