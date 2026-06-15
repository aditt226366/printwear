-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CompanyStatus" AS ENUM ('active', 'inactive');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AppUserRole" AS ENUM ('ADMIN', 'USER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AppUserStatus" AS ENUM ('active', 'inactive');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ApiProvider" AS ENUM ('META_WHATSAPP', 'META_ADS', 'CLAUDE', 'GOOGLE_SHEETS', 'INTERNAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "CompanyStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AppUser" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "AppUserRole" NOT NULL,
    "status" "AppUserStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CompanyFeature" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "featureName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ApiUsageLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "provider" "ApiProvider" NOT NULL,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "requestUnits" INTEGER NOT NULL DEFAULT 1,
    "costEstimate" DECIMAL(65,30),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BillingSnapshot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "whatsappApiCalls" INTEGER NOT NULL DEFAULT 0,
    "metaAdsApiCalls" INTEGER NOT NULL DEFAULT 0,
    "claudeApiCalls" INTEGER NOT NULL DEFAULT 0,
    "googleSheetsApiCalls" INTEGER NOT NULL DEFAULT 0,
    "totalApiCalls" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Company_slug_key" ON "Company"("slug");
CREATE INDEX IF NOT EXISTS "Company_status_idx" ON "Company"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "AppUser_username_key" ON "AppUser"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "AppUser_email_key" ON "AppUser"("email");
CREATE INDEX IF NOT EXISTS "AppUser_companyId_idx" ON "AppUser"("companyId");
CREATE INDEX IF NOT EXISTS "AppUser_role_idx" ON "AppUser"("role");
CREATE INDEX IF NOT EXISTS "AppUser_status_idx" ON "AppUser"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "CompanyFeature_companyId_featureKey_key" ON "CompanyFeature"("companyId", "featureKey");
CREATE INDEX IF NOT EXISTS "CompanyFeature_companyId_idx" ON "CompanyFeature"("companyId");
CREATE INDEX IF NOT EXISTS "CompanyFeature_featureKey_idx" ON "CompanyFeature"("featureKey");
CREATE INDEX IF NOT EXISTS "ApiUsageLog_companyId_createdAt_idx" ON "ApiUsageLog"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "ApiUsageLog_provider_createdAt_idx" ON "ApiUsageLog"("provider", "createdAt");
CREATE INDEX IF NOT EXISTS "ApiUsageLog_userId_idx" ON "ApiUsageLog"("userId");
CREATE INDEX IF NOT EXISTS "BillingSnapshot_companyId_periodStart_periodEnd_idx" ON "BillingSnapshot"("companyId", "periodStart", "periodEnd");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "AppUser" ADD CONSTRAINT "AppUser_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "CompanyFeature" ADD CONSTRAINT "CompanyFeature_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ApiUsageLog" ADD CONSTRAINT "ApiUsageLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ApiUsageLog" ADD CONSTRAINT "ApiUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "BillingSnapshot" ADD CONSTRAINT "BillingSnapshot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
