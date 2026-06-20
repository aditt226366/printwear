import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";

const REQUIRED_TABLES = [
  "Company",
  "AppUser",
  "CompanyFeature",
  "CompanyIntegration",
  "Integration",
  "IntegrationAudit",
  "ApiUsageLog",
  "BillingSnapshot",
  "BulkMessageJob",
  "BulkMessageRecipient",
  "Campaign",
  "CampaignRecipient",
  "AdDraft",
  "AdCampaign",
  "AdAudience",
  "AdEvent",
  "AdSyncLog",
  "AiWorkflow",
  "WorkflowExecutionLog"
];

const REQUIRED_MIGRATIONS = [
  "20260615170000_company_users_billing",
  "20260615190000_multi_tenant_company_isolation",
  "20260616170000_company_integrations",
  "20260618100000_integration_vault",
  "20260620120000_meta_ads_module"
];

export type DatabaseSchemaStatus = {
  databaseConnected: boolean;
  schemaVerified: boolean;
  migrationApplied: boolean;
  tables: string[];
  missingTables: string[];
  migrations: string[];
  missingMigrations: string[];
  companyCount: number;
  userCount: number;
  nodeVersion: string;
  prismaVersion: string;
  error?: string;
};

async function countTable(tableName: string, tables: Set<string>) {
  if (!tables.has(tableName)) return 0;
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`SELECT COUNT(*)::bigint AS count FROM ${Prisma.raw(`"${tableName}"`)}`
  );
  return Number(rows[0]?.count ?? 0);
}

export const systemStatusService = {
  requiredTables: REQUIRED_TABLES,
  requiredMigrations: REQUIRED_MIGRATIONS,

  async databaseSchema(): Promise<DatabaseSchemaStatus> {
    try {
      await prisma.$queryRaw`SELECT 1`;

      const [tableRows, migrationRows] = await Promise.all([
        prisma.$queryRaw<Array<{ table_name: string }>>`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name IN (${Prisma.join(REQUIRED_TABLES)})
          ORDER BY table_name
        `,
        prisma.$queryRaw<Array<{ migration_name: string }>>`
          SELECT migration_name
          FROM "_prisma_migrations"
          ORDER BY finished_at NULLS LAST, started_at
        `.catch(() => [])
      ]);

      const existingTables = new Set(tableRows.map((table) => table.table_name));
      const migrations = migrationRows.map((migration) => migration.migration_name);
      const migrationSet = new Set(migrations);
      const missingTables = REQUIRED_TABLES.filter((tableName) => !existingTables.has(tableName));
      const missingMigrations = REQUIRED_MIGRATIONS.filter((migrationName) => !migrationSet.has(migrationName));
      const [companyCount, userCount] = await Promise.all([
        countTable("Company", existingTables),
        countTable("AppUser", existingTables)
      ]);

      return {
        databaseConnected: true,
        schemaVerified: missingTables.length === 0,
        migrationApplied: missingMigrations.length === 0 && missingTables.length === 0,
        tables: REQUIRED_TABLES.filter((tableName) => existingTables.has(tableName)),
        missingTables,
        migrations,
        missingMigrations,
        companyCount,
        userCount,
        nodeVersion: process.version,
        prismaVersion: Prisma.prismaVersion.client
      };
    } catch (error) {
      return {
        databaseConnected: false,
        schemaVerified: false,
        migrationApplied: false,
        tables: [],
        missingTables: REQUIRED_TABLES,
        migrations: [],
        missingMigrations: REQUIRED_MIGRATIONS,
        companyCount: 0,
        userCount: 0,
        nodeVersion: process.version,
        prismaVersion: Prisma.prismaVersion.client,
        error: error instanceof Error ? error.message : "Database schema verification failed"
      };
    }
  },

  async getStatus() {
    const schema = await this.databaseSchema();
    return {
      ...schema,
      adminUserExists: schema.userCount > 0,
      setupComplete: schema.schemaVerified && schema.userCount > 0 && schema.companyCount > 0
    };
  }
};
