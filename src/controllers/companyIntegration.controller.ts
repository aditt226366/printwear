import type { Request, Response } from "express";
import { companyIntegrationService } from "../services/companyIntegration.service.js";
import { integrationVerificationService } from "../services/integrationVerification.service.js";
import { webhookStatusService } from "../services/webhookStatus.service.js";
import { asyncHandler } from "../utils/errors.js";
import { sessionCompanyId } from "../utils/tenant.js";

const providerMap = {
  "google-sheets": "GOOGLE_SHEETS",
  whatsapp: "WHATSAPP_CLOUD",
  "whatsapp-cloud": "WHATSAPP_CLOUD",
  "whatsapp-template-settings": "WHATSAPP_TEMPLATE_SETTINGS",
  "meta-ads": "META_ADS",
  "knowledge-base": "KNOWLEDGE_BASE",
  "ai-model": "AI_MODEL"
} as const;

function actorUserId(res: Response) {
  return res.locals.session?.userId ?? null;
}

function bodyWithFile(req: Request) {
  const body = { ...(req.body ?? {}) } as Record<string, unknown>;
  if (req.file) {
    body.documentName = req.file.originalname;
    body.documentType = req.file.mimetype;
  }
  return body;
}

function webhookUrl(req: Request) {
  const protocol = req.get("x-forwarded-proto") ?? req.protocol;
  const host = req.get("host") ?? "localhost";
  return `${protocol}://${host}/api/webhooks/whatsapp/${encodeURIComponent(req.params.companyId || "")}`;
}

function withRuntimeMetadata(req: Request, integration: Record<string, unknown>) {
  if (integration.type !== "WHATSAPP_CLOUD") return integration;

  const snapshot = webhookStatusService.snapshot(webhookUrl(req));
  const fieldState = integration.fieldState as Record<string, { exists?: boolean }> | undefined;
  const verifyTokenSaved = Boolean(fieldState?.WHATSAPP_VERIFY_TOKEN?.exists);
  return {
    ...integration,
    metadata: {
      ...((integration.metadata ?? {}) as Record<string, unknown>),
      webhookUrl: snapshot.webhookUrl,
      verifyTokenStatus: verifyTokenSaved ? "Saved securely" : "Missing",
      webhookVerificationStatus: verifyTokenSaved ? "Ready for Meta verification" : "Verify token missing",
      lastWebhookReceivedAt: snapshot.lastWebhookReceivedAt,
      messageStatusWebhookStatus: snapshot.lastWhatsAppSendStatus.status
    }
  };
}

function normalizeProvider(provider: string) {
  return providerMap[provider as keyof typeof providerMap] ?? provider;
}

export const getIntegrationCompanyCards = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ companies: await companyIntegrationService.listIntegrationCompanyCards() });
});

export const getCompanyIntegrations = asyncHandler(async (req: Request, res: Response) => {
  const integrations = await companyIntegrationService.listCompanyIntegrations(req.params.companyId);
  res.json({ integrations: integrations.map((integration) => withRuntimeMetadata(req, integration)) });
});

export const getCompanyIntegrationByType = asyncHandler(async (req: Request, res: Response) => {
  const integration = await companyIntegrationService.getCompanyIntegration(req.params.companyId, normalizeProvider(req.params.type));
  res.json({ integration: withRuntimeMetadata(req, integration) });
});

export const patchCompanyIntegration = asyncHandler(async (req: Request, res: Response) => {
  const type = normalizeProvider(req.params.type);
  const input = bodyWithFile(req);
  const integration = await companyIntegrationService.saveIntegration(req.params.companyId, type, input, actorUserId(res));

  if (String(req.query.verify || "").toLowerCase() === "true") {
    const verification = await integrationVerificationService.verify(req.params.companyId, type, {
      input,
      file: req.file,
      actorUserId: actorUserId(res),
      persist: true
    });
    res.json({ verification, integration: withRuntimeMetadata(req, verification.integration ?? integration) });
    return;
  }

  res.json({ integration: withRuntimeMetadata(req, integration) });
});

export const verifyCompanyIntegration = asyncHandler(async (req: Request, res: Response) => {
  const type = normalizeProvider(req.params.type);
  const input = bodyWithFile(req);
  if (Object.keys(input).length || req.file) {
    await companyIntegrationService.saveIntegration(req.params.companyId, type, input, actorUserId(res));
  }
  const verification = await integrationVerificationService.verify(req.params.companyId, type, {
    input,
    file: req.file,
    actorUserId: actorUserId(res),
    persist: true
  });
  res.json({ verification, integration: withRuntimeMetadata(req, verification.integration ?? {}) });
});

export const testCompanyIntegration = asyncHandler(async (req: Request, res: Response) => {
  const type = normalizeProvider(req.params.type);
  const verification = await integrationVerificationService.test(req.params.companyId, type, {
    input: bodyWithFile(req),
    file: req.file,
    actorUserId: actorUserId(res)
  });
  res.json({ test: verification });
});

export const disconnectCompanyIntegration = asyncHandler(async (req: Request, res: Response) => {
  const integration = await companyIntegrationService.disconnectIntegration(
    req.params.companyId,
    normalizeProvider(req.params.type),
    actorUserId(res)
  );
  res.json({ integration: withRuntimeMetadata(req, integration) });
});

export const getCompanyIntegration = asyncHandler(async (req: Request, res: Response) => {
  const companyId = String(req.query.companyId || "").trim();
  res.json({ integration: await companyIntegrationService.listAdmin(companyId) });
});

export const updateCompanyIntegration = asyncHandler(async (req: Request, res: Response) => {
  const companyId = String(req.body?.companyId || "").trim();
  res.json({ integration: await companyIntegrationService.updateAdmin(companyId, req.body ?? {}) });
});

export const clearCompanyIntegrationProvider = asyncHandler(async (req: Request, res: Response) => {
  const provider = providerMap[req.params.provider as keyof typeof providerMap];
  const integration = await companyIntegrationService.disconnectIntegration(req.params.companyId, provider ?? req.params.provider, actorUserId(res));
  res.json({ integration });
});

export const getIntegrationStatus = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ integration: await companyIntegrationService.userStatus(sessionCompanyId(res)) });
});

export const testWhatsAppIntegration = asyncHandler(async (req: Request, res: Response) => {
  res.json({ test: await integrationVerificationService.test(req.params.companyId, "WHATSAPP_CLOUD", { input: req.body ?? {} }) });
});

export const testGoogleSheetsIntegration = asyncHandler(async (req: Request, res: Response) => {
  res.json({ test: await integrationVerificationService.test(req.params.companyId, "GOOGLE_SHEETS", { input: req.body ?? {} }) });
});

export const testMetaAdsIntegration = asyncHandler(async (req: Request, res: Response) => {
  res.json({ test: await integrationVerificationService.test(req.params.companyId, "META_ADS", { input: req.body ?? {} }) });
});
