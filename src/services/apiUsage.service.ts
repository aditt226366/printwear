import { ApiProvider } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { logger } from "../utils/logger.js";
import { scrubSecretsFromLogs } from "../utils/secretVault.js";

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

async function resolveCompanyId(companyId?: string | null) {
  if (companyId) return companyId;
  return null;
}

export const apiUsageService = {
  async log(input: UsageInput) {
    try {
      const companyId = await resolveCompanyId(input.companyId);
      if (!companyId) {
        logger.warn({ provider: input.provider, endpoint: input.endpoint }, "API usage log skipped because companyId is missing");
        return;
      }

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
          metadata: scrubSecretsFromLogs(input.metadata || {}) as object
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
