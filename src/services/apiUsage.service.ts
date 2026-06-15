import { ApiProvider } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { logger } from "../utils/logger.js";

type UsageInput = {
  companyId?: string | null;
  userId?: string | null;
  provider: keyof typeof ApiProvider;
  endpoint: string;
  method: string;
  statusCode: number;
  success: boolean;
  requestUnits?: number;
  costEstimate?: number | null;
  metadata?: Record<string, unknown>;
};

let defaultCompanyId: string | null = null;

async function resolveCompanyId(companyId?: string | null) {
  if (companyId) return companyId;
  if (defaultCompanyId) return defaultCompanyId;
  const company = await prisma.company.upsert({
    where: { slug: "printwear" },
    update: {},
    create: { name: "Printwear", slug: "printwear" }
  });
  defaultCompanyId = company.id;
  return company.id;
}

export const apiUsageService = {
  async log(input: UsageInput) {
    try {
      const companyId = await resolveCompanyId(input.companyId);
      await prisma.apiUsageLog.create({
        data: {
          companyId,
          userId: input.userId || null,
          provider: ApiProvider[input.provider],
          endpoint: input.endpoint,
          method: input.method,
          statusCode: input.statusCode,
          success: input.success,
          requestUnits: input.requestUnits ?? 1,
          costEstimate: input.costEstimate ?? null,
          metadata: (input.metadata || {}) as object
        }
      });
    } catch (error) {
      logger.warn({ error, provider: input.provider, endpoint: input.endpoint }, "API usage log skipped");
    }
  }
};

export async function logApiUsage(
  companyId: string | null | undefined,
  provider: keyof typeof ApiProvider,
  endpoint: string,
  method: string,
  statusCode: number,
  success: boolean,
  metadata: Record<string, unknown> = {}
) {
  await apiUsageService.log({ companyId, provider, endpoint, method, statusCode, success, metadata });
}
