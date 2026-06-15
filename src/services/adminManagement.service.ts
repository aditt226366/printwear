import { ApiProvider, AppUserRole, AppUserStatus, CompanyStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/errors.js";
import { authService } from "./auth.service.js";
import { featureFlagService } from "./featureFlag.service.js";

function slugify(value: string) {
  return authService.slugify(value);
}

function userPublicSelect() {
  return {
    id: true,
    companyId: true,
    name: true,
    username: true,
    email: true,
    role: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    lastLoginAt: true,
    company: { select: { id: true, name: true, slug: true } }
  } satisfies Prisma.AppUserSelect;
}

function usageWhere(input: { companyId?: string; start?: string; end?: string }) {
  return {
    ...(input.companyId ? { companyId: input.companyId } : {}),
    ...(input.start || input.end
      ? {
          createdAt: {
            ...(input.start ? { gte: new Date(input.start) } : {}),
            ...(input.end ? { lte: new Date(input.end) } : {})
          }
        }
      : {})
  } satisfies Prisma.ApiUsageLogWhereInput;
}

export const adminManagementService = {
  async listCompanies() {
    return prisma.company.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { users: true } } }
    });
  },

  async createCompany(input: { name: string; slug?: string; status?: keyof typeof CompanyStatus }) {
    const slug = slugify(input.slug || input.name);
    const company = await prisma.company.create({
      data: {
        name: input.name,
        slug,
        status: input.status ? CompanyStatus[input.status] : CompanyStatus.ACTIVE
      }
    });
    await featureFlagService.ensureDefaultsForCompany(company.id);
    return company;
  },

  async listUsers() {
    return prisma.appUser.findMany({
      orderBy: { createdAt: "desc" },
      select: userPublicSelect()
    });
  },

  async createUser(input: {
    companyId?: string | null;
    name: string;
    username: string;
    email?: string | null;
    password: string;
    status?: keyof typeof AppUserStatus;
  }) {
    if (input.password.length < 8) throw new AppError("Password must be at least 8 characters", 400);
    if (input.companyId) await featureFlagService.ensureDefaultsForCompany(input.companyId);
    return prisma.appUser.create({
      data: {
        companyId: input.companyId || null,
        name: input.name,
        username: input.username.trim().toLowerCase(),
        email: input.email?.trim().toLowerCase() || null,
        passwordHash: await authService.hashPassword(input.password),
        role: AppUserRole.USER,
        status: input.status ? AppUserStatus[input.status] : AppUserStatus.ACTIVE
      },
      select: userPublicSelect()
    });
  },

  async updateUser(id: string, input: { name?: string; email?: string | null; companyId?: string | null; status?: keyof typeof AppUserStatus }) {
    if (input.companyId) await featureFlagService.ensureDefaultsForCompany(input.companyId);
    return prisma.appUser.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email?.trim().toLowerCase() || null } : {}),
        ...(input.companyId !== undefined ? { companyId: input.companyId || null } : {}),
        ...(input.status !== undefined ? { status: AppUserStatus[input.status] } : {})
      },
      select: userPublicSelect()
    });
  },

  async resetPassword(id: string, password: string) {
    if (password.length < 8) throw new AppError("Password must be at least 8 characters", 400);
    return prisma.appUser.update({
      where: { id },
      data: { passwordHash: await authService.hashPassword(password) },
      select: userPublicSelect()
    });
  },

  async billing(input: { companyId?: string; start?: string; end?: string }) {
    const where = usageWhere(input);
    const logs = await prisma.apiUsageLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        company: { select: { id: true, name: true } },
        user: { select: { id: true, username: true, name: true } }
      }
    });
    const summary = {
      whatsappApiCalls: 0,
      metaAdsApiCalls: 0,
      claudeApiCalls: 0,
      googleSheetsApiCalls: 0,
      totalApiCalls: 0,
      estimatedCost: 0
    };

    for (const log of logs) {
      const units = Number(log.requestUnits || 0);
      summary.totalApiCalls += units;
      summary.estimatedCost += Number(log.costEstimate || 0);
      if (log.provider === ApiProvider.META_WHATSAPP) summary.whatsappApiCalls += units;
      if (log.provider === ApiProvider.META_ADS) summary.metaAdsApiCalls += units;
      if (log.provider === ApiProvider.CLAUDE) summary.claudeApiCalls += units;
      if (log.provider === ApiProvider.GOOGLE_SHEETS) summary.googleSheetsApiCalls += units;
    }

    return { summary, logs };
  },

  async billingCsv(input: { companyId?: string; start?: string; end?: string }) {
    const { logs } = await this.billing(input);
    const rows = [
      ["createdAt", "company", "provider", "endpoint", "method", "statusCode", "success", "requestUnits", "costEstimate"],
      ...logs.map((log) => [
        log.createdAt.toISOString(),
        log.company.name,
        log.provider,
        log.endpoint,
        log.method,
        String(log.statusCode),
        String(log.success),
        String(log.requestUnits),
        String(log.costEstimate ?? "")
      ])
    ];
    return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  }
};
