import { AppUserRole } from "@prisma/client";
import { prisma } from "../config/prisma.js";

const REQUIRED_MIGRATION = "20260615170000_company_users_billing";

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
      const [migration, adminCount, userCount, companyCount] = await Promise.all([
        prisma.$queryRaw<Array<{ migration_name: string }>>`
          SELECT migration_name
          FROM "_prisma_migrations"
          WHERE migration_name = ${REQUIRED_MIGRATION}
          LIMIT 1
        `,
        prisma.appUser.count({ where: { role: AppUserRole.ADMIN } }),
        prisma.appUser.count(),
        prisma.company.count()
      ]);

      const migrationApplied = migration.length > 0;
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
