import { ApiProvider, AppUserRole, AppUserStatus, CompanyStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { authService } from "./auth.service.js";
import { DEFAULT_FEATURES } from "./featureFlag.service.js";
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

function parseDateFilter(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError("Invalid billing date filter", 400);
  return date;
}

function usageWhere(input: { companyId?: string; from?: string; to?: string }) {
  const from = parseDateFilter(input.from);
  const to = parseDateFilter(input.to);
  return {
    ...(input.companyId ? { companyId: input.companyId } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {})
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

  async createCompany(input: {
    name: string;
    slug?: string;
    status?: keyof typeof CompanyStatus;
    logoUrl?: string | null;
    whatsappNumber?: string | null;
    brandColor?: string | null;
    timezone?: string | null;
    businessType?: string | null;
  }) {
    const started = performance.now();
    const slug = slugify(input.slug || input.name);
    const company = await prisma.$transaction(async (tx) => {
      try {
        const created = await tx.company.create({
          data: {
            name: input.name,
            slug,
            status: input.status ? CompanyStatus[input.status] : CompanyStatus.ACTIVE,
            logoUrl: input.logoUrl || null,
            whatsappNumber: input.whatsappNumber || null,
            brandColor: input.brandColor || null,
            timezone: input.timezone || null,
            businessType: input.businessType || null
          }
        });
        await tx.companyFeature.createMany({
          data: DEFAULT_FEATURES.map((feature) => ({
            companyId: created.id,
            featureKey: feature.key,
            featureName: feature.label,
            enabled: feature.enabled
          })),
          skipDuplicates: true
        });
        return created;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new AppError("A company with this slug already exists.", 409);
        }
        throw error;
      }
    });
    logger.info({ createCompanyMs: Math.round(performance.now() - started), companyId: company.id }, "Company created");
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
    const started = performance.now();
    if (input.password.length < 8) throw new AppError("Password must be at least 8 characters", 400);
    if (input.companyId) await featureFlagService.ensureDefaultsForCompany(input.companyId);
    const user = await (async () => {
      try {
        return await prisma.appUser.create({
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
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new AppError("A user with this username or email already exists.", 409);
        }
        throw error;
      }
    })();
    logger.info({ createUserMs: Math.round(performance.now() - started), userId: user.id, companyId: user.companyId }, "User created");
    return user;
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

  async billing(input: { companyId?: string; from?: string; to?: string }) {
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
      internalApiCalls: 0,
      totalApiCalls: 0,
      estimatedCost: "-NIL-"
    };

    for (const log of logs) {
      const units = Number(log.requestUnits || 0);
      summary.totalApiCalls += units;
      if (log.provider === ApiProvider.META_WHATSAPP) summary.whatsappApiCalls += units;
      if (log.provider === ApiProvider.META_ADS) summary.metaAdsApiCalls += units;
      if (log.provider === ApiProvider.CLAUDE) summary.claudeApiCalls += units;
      if (log.provider === ApiProvider.GOOGLE_SHEETS) summary.googleSheetsApiCalls += units;
      if (log.provider === ApiProvider.INTERNAL) summary.internalApiCalls += units;
    }

    return {
      summary,
      logs: logs.map((log) => ({
        id: log.id,
        createdAt: log.createdAt,
        company: log.company,
        provider: log.provider,
        endpoint: log.endpoint,
        method: log.method,
        statusCode: log.statusCode,
        success: log.success,
        requestUnits: log.requestUnits
      }))
    };
  },

  async billingCsv(input: { companyId?: string; from?: string; to?: string }) {
    const { logs } = await this.billing(input);
    const rows = [
      ["createdAt", "company", "provider", "endpoint", "method", "statusCode", "success", "requestUnits"],
      ...logs.map((log) => [
        log.createdAt.toISOString(),
        log.company.name,
        log.provider,
        log.endpoint,
        log.method,
        String(log.statusCode),
        String(log.success),
        String(log.requestUnits)
      ])
    ];
    return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  }
};
