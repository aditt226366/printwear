-- CreateEnum
CREATE TYPE "HumanPriority" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('collecting_details', 'ready_for_review', 'quotation_needed', 'confirmed', 'ready_for_dispatch', 'dispatched', 'cancelled');

-- AlterTable
ALTER TABLE "Lead"
ADD COLUMN "humanTakeoverRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "humanPriority" "HumanPriority",
ADD COLUMN "humanReason" TEXT,
ADD COLUMN "humanResolvedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OrderSummary" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "productType" TEXT,
    "quantity" INTEGER,
    "size" TEXT,
    "color" TEXT,
    "gsm" TEXT,
    "customization" TEXT,
    "deliveryLocation" TEXT,
    "notes" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'collecting_details',
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_humanTakeoverRequired_humanResolvedAt_idx" ON "Lead"("humanTakeoverRequired", "humanResolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderSummary_leadId_key" ON "OrderSummary"("leadId");

-- CreateIndex
CREATE INDEX "OrderSummary_status_idx" ON "OrderSummary"("status");

-- CreateIndex
CREATE INDEX "OrderSummary_updatedAt_idx" ON "OrderSummary"("updatedAt");

-- AddForeignKey
ALTER TABLE "OrderSummary" ADD CONSTRAINT "OrderSummary_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
