import { AppUserRole, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";

const REQUIRED_MIGRATION = "20260615170000_company_users_billing";
const REQUIRED_TABLES = [
  "Company",
  "AppUser",
  "CompanyFeature",
  "ApiUsageLog",
  "BillingSnapshot",
  "BulkMessageJob",
  "BulkMessageRecipient",
  "Campaign",
  "CampaignRecipient",
  "AdDraft",
  "AiWorkflow",
  "WorkflowExecutionLog"
];

export type SystemStatus = {
  databaseConnected: boolean;
  migrationApplied: boolean;
  adminUserExists: boolean;
  userCount: number;
  companyCount: number;
  setupComplete: boolean;
  error?: string;
};

export const systemStatusService = {
  async getStatus(): Promise<SystemStatus> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const [migration, tables, adminCount, userCount, companyCount] = await Promise.all([
        prisma.$queryRaw<Array<{ migration_name: string }>>`
          SELECT migration_name
          FROM "_prisma_migrations"
          WHERE migration_name = ${REQUIRED_MIGRATION}
          LIMIT 1
        `,
        prisma.$queryRaw<Array<{ table_name: string }>>`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN (${Prisma.join(REQUIRED_TABLES)})
        `,
        prisma.appUser.count({ where: { role: AppUserRole.ADMIN } }),
        prisma.appUser.count(),
        prisma.company.count()
      ]);

      const existingTables = new Set(tables.map((table) => table.table_name));
      const requiredTablesExist = REQUIRED_TABLES.every((tableName) => existingTables.has(tableName));
      const migrationApplied = migration.length > 0 && requiredTablesExist;
      const adminUserExists = adminCount > 0;

      return {
        databaseConnected: true,
        migrationApplied,
        adminUserExists,
        userCount,
        companyCount,
        setupComplete: migrationApplied && adminUserExists && userCount > 0 && companyCount > 0
      };
    } catch (error) {
      return {
        databaseConnected: false,
        migrationApplied: false,
        adminUserExists: false,
        userCount: 0,
        companyCount: 0,
        setupComplete: false,
        error: error instanceof Error ? error.message : "Database status check failed"
      };
    }
  }
};
