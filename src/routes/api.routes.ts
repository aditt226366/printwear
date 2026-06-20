import { Router } from "express";
import multer from "multer";
import {
  getDashboard,
  getConversation,
  getHumanActionQueue,
  getLeads,
  getOrderPipeline,
  performOrderAction,
  requestHumanAction,
  resolveHumanAction,
  sendManualMessage,
  streamChatEvents,
  updateOrder,
  updateOrderStatus
} from "../controllers/admin.controller.js";
import { getCommandCenter } from "../controllers/commandCenter.controller.js";
import { importLeads } from "../controllers/leads.controller.js";
import { listKnowledgeBase, seedKnowledgeBase } from "../controllers/knowledge.controller.js";
import { sendInitialMessages } from "../controllers/messages.controller.js";
import { getWebhookStatus } from "../controllers/webhook.controller.js";
import { getAdminFeatures, getEnabledFeatures, getSession, updateAdminFeature } from "../controllers/feature.controller.js";
import {
  createCompany,
  createUser,
  exportBillingCsv,
  getBilling,
  listCompanies,
  listUsers,
  resetUserPassword,
  updateUser
} from "../controllers/adminManagement.controller.js";
import {
  clearCompanyIntegrationProvider,
  getCompanyIntegration,
  getCompanyIntegrationByType,
  getCompanyIntegrations,
  getIntegrationCompanyCards,
  getIntegrationStatus,
  disconnectCompanyIntegration,
  patchCompanyIntegration,
  testCompanyIntegration,
  testGoogleSheetsIntegration,
  testMetaAdsIntegration,
  testWhatsAppIntegration,
  verifyCompanyIntegration,
  updateCompanyIntegration
} from "../controllers/companyIntegration.controller.js";
import {
  cancelCampaign,
  createAdDraft,
  createBulkSend,
  createCampaign,
  createContact,
  createWorkflow,
  deleteAdDraft,
  deleteCampaign,
  deleteWorkflow,
  duplicateWorkflow,
  getCampaign,
  getAutomationSetup,
  getAdsStatus,
  importContactsCsv,
  importContactsSheets,
  listAdDrafts,
  listBulkJobs,
  listCampaigns,
  listContacts,
  listWorkflows,
  pauseCampaign,
  resumeCampaign,
  updateWorkflow
} from "../controllers/automation.controller.js";
import {
  cancelAppAd,
  createAppAd,
  getAppAd,
  getAppAdAnalytics,
  launchAppAd,
  listAppAds,
  markAppAdManuallyLaunched,
  pauseAppAd,
  resumeAppAd,
  syncAppAdInsights,
  updateAppAd
} from "../controllers/adCampaign.controller.js";
import { requireAdmin, requireSession } from "../middleware/auth.middleware.js";
import { requireFeature } from "../middleware/feature.middleware.js";
import { requireActiveTenant, requirePrintwearTenant, requireTenantUser } from "../middleware/printwear.middleware.js";
import { getDatabaseSchema, getIntegrationConfig, getSystemStatus } from "../controllers/systemStatus.controller.js";
import { getGoogleSheetsStatus } from "../controllers/googleSheets.controller.js";
import { AppError } from "../utils/errors.js";
import {
  getPrintwearDashboard,
  getPrintwearHumanQueue,
  getPrintwearIntegrationStatus,
  getPrintwearLeads,
  getPrintwearOrders,
  importAndSendPrintwearTemplate,
  indexPrintwearKnowledgeBase,
  syncPrintwearSheet,
  testPrintwearAI,
  testPrintwearKnowledgeBase
} from "../controllers/printwear.controller.js";

export const apiRoutes = Router();

const integrationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, callback) {
    const allowedTypes = new Set(["application/pdf"]);

    if (allowedTypes.has(file.mimetype)) {
      callback(null, true);
      return;
    }

    callback(new AppError("Only PDF files are supported", 400));
  }
});

apiRoutes.get("/automation/setup", getAutomationSetup);
apiRoutes.get("/debug/system-status", getSystemStatus);

apiRoutes.use(requireSession);

apiRoutes.get("/session", getSession);
apiRoutes.get("/features/enabled", getEnabledFeatures);
apiRoutes.get("/admin/companies", requireAdmin, listCompanies);
apiRoutes.post("/admin/companies", requireAdmin, createCompany);
apiRoutes.get("/admin/users", requireAdmin, listUsers);
apiRoutes.post("/admin/users", requireAdmin, createUser);
apiRoutes.patch("/admin/users/:id", requireAdmin, updateUser);
apiRoutes.post("/admin/users/:id/reset-password", requireAdmin, resetUserPassword);
apiRoutes.get("/admin/features", requireAdmin, getAdminFeatures);
apiRoutes.patch("/admin/features/:key", requireAdmin, updateAdminFeature);
apiRoutes.get("/admin/billing", requireAdmin, getBilling);
apiRoutes.get("/admin/billing/export", requireAdmin, exportBillingCsv);
apiRoutes.get("/admin/integrations/companies", requireAdmin, getIntegrationCompanyCards);
apiRoutes.get("/admin/companies/:companyId/integrations", requireAdmin, getCompanyIntegrations);
apiRoutes.get("/admin/companies/:companyId/integrations/:type", requireAdmin, getCompanyIntegrationByType);
apiRoutes.patch("/admin/companies/:companyId/integrations/:type", requireAdmin, integrationUpload.single("pdfFile"), patchCompanyIntegration);
apiRoutes.post("/admin/companies/:companyId/integrations/:type/verify", requireAdmin, integrationUpload.single("pdfFile"), verifyCompanyIntegration);
apiRoutes.post("/admin/companies/:companyId/integrations/:type/test", requireAdmin, integrationUpload.single("pdfFile"), testCompanyIntegration);
apiRoutes.post("/admin/companies/:companyId/integrations/:type/disconnect", requireAdmin, disconnectCompanyIntegration);
apiRoutes.get("/admin/company-integrations", requireAdmin, getCompanyIntegration);
apiRoutes.put("/admin/company-integrations", requireAdmin, updateCompanyIntegration);
apiRoutes.delete("/admin/company-integrations/:companyId/:provider", requireAdmin, clearCompanyIntegrationProvider);
apiRoutes.post("/admin/company-integrations/:companyId/test/whatsapp", requireAdmin, testWhatsAppIntegration);
apiRoutes.post("/admin/company-integrations/:companyId/test/google-sheets", requireAdmin, testGoogleSheetsIntegration);
apiRoutes.post("/admin/company-integrations/:companyId/test/meta-ads", requireAdmin, testMetaAdsIntegration);

apiRoutes.get("/dashboard", getDashboard);
apiRoutes.get("/app/integrations/status", getIntegrationStatus);
apiRoutes.get("/integrations/status", getIntegrationStatus);
apiRoutes.use("/app/printwear", requireTenantUser, requireActiveTenant, requirePrintwearTenant);
apiRoutes.get("/app/printwear/dashboard", getPrintwearDashboard);
apiRoutes.get("/app/printwear/integration-status", getPrintwearIntegrationStatus);
apiRoutes.post("/app/printwear/sync-sheet", syncPrintwearSheet);
apiRoutes.post("/app/printwear/import-and-send-template", importAndSendPrintwearTemplate);
apiRoutes.get("/app/printwear/leads", getPrintwearLeads);
apiRoutes.get("/app/printwear/orders", getPrintwearOrders);
apiRoutes.get("/app/printwear/human-queue", getPrintwearHumanQueue);
apiRoutes.post("/app/printwear/knowledge-base/index", integrationUpload.single("pdfFile"), indexPrintwearKnowledgeBase);
apiRoutes.post("/app/printwear/knowledge-base/test", testPrintwearKnowledgeBase);
apiRoutes.post("/app/printwear/ai/test", testPrintwearAI);
apiRoutes.get("/debug/database-schema", requireAdmin, getDatabaseSchema);
apiRoutes.get("/debug/integration-config", requireAdmin, getIntegrationConfig);
apiRoutes.get("/debug/google-sheets-status", requireAdmin, getGoogleSheetsStatus);
apiRoutes.get("/debug/webhook-status", requireFeature("settings"), getWebhookStatus);
apiRoutes.get("/app/ads", requireFeature("ads"), listAppAds);
apiRoutes.post("/app/ads", requireFeature("ads"), createAppAd);
apiRoutes.get("/app/ads/:id", requireFeature("ads"), getAppAd);
apiRoutes.patch("/app/ads/:id", requireFeature("ads"), updateAppAd);
apiRoutes.post("/app/ads/:id/launch", requireFeature("ads"), launchAppAd);
apiRoutes.post("/app/ads/:id/mark-manually-launched", requireFeature("ads"), markAppAdManuallyLaunched);
apiRoutes.post("/app/ads/:id/pause", requireFeature("ads"), pauseAppAd);
apiRoutes.post("/app/ads/:id/resume", requireFeature("ads"), resumeAppAd);
apiRoutes.post("/app/ads/:id/cancel", requireFeature("ads"), cancelAppAd);
apiRoutes.get("/app/ads/:id/analytics", requireFeature("ads"), getAppAdAnalytics);
apiRoutes.post("/app/ads/:id/sync-insights", requireFeature("ads"), syncAppAdInsights);
apiRoutes.get("/command-center", requireFeature("dashboard"), getCommandCenter);
apiRoutes.get("/events", requireFeature("chats"), streamChatEvents);
apiRoutes.get("/leads", requireFeature("chats"), getLeads);
apiRoutes.get("/leads/:leadId/conversation", requireFeature("chats"), getConversation);
apiRoutes.post("/leads/:leadId/messages", requireFeature("chats"), sendManualMessage);
apiRoutes.post("/leads/import", requireFeature("dashboard"), importLeads);
apiRoutes.get("/contacts", requireFeature("broadcasts"), listContacts);
apiRoutes.post("/contacts", requireFeature("broadcasts"), createContact);
apiRoutes.post("/contacts/import/csv", requireFeature("broadcasts"), importContactsCsv);
apiRoutes.post("/contacts/import/google-sheets", requireFeature("broadcasts"), importContactsSheets);
apiRoutes.get("/bulk-messages", requireFeature("broadcasts"), listBulkJobs);
apiRoutes.post("/bulk-messages", requireFeature("broadcasts"), createBulkSend);
apiRoutes.get("/campaigns", requireFeature("campaigns"), listCampaigns);
apiRoutes.post("/campaigns", requireFeature("campaigns"), createCampaign);
apiRoutes.get("/campaigns/:campaignId", requireFeature("campaigns"), getCampaign);
apiRoutes.post("/campaigns/:campaignId/pause", requireFeature("campaigns"), pauseCampaign);
apiRoutes.post("/campaigns/:campaignId/resume", requireFeature("campaigns"), resumeCampaign);
apiRoutes.post("/campaigns/:campaignId/cancel", requireFeature("campaigns"), cancelCampaign);
apiRoutes.delete("/campaigns/:campaignId", requireFeature("campaigns"), deleteCampaign);
apiRoutes.get("/ads", requireFeature("ads"), listAdDrafts);
apiRoutes.get("/ads/status", requireFeature("ads"), getAdsStatus);
apiRoutes.post("/ads", requireFeature("ads"), createAdDraft);
apiRoutes.delete("/ads/:adDraftId", requireFeature("ads"), deleteAdDraft);
apiRoutes.get("/ai-flows", requireFeature("ai_flows"), listWorkflows);
apiRoutes.post("/ai-flows", requireFeature("ai_flows"), createWorkflow);
apiRoutes.patch("/ai-flows/:workflowId", requireFeature("ai_flows"), updateWorkflow);
apiRoutes.post("/ai-flows/:workflowId/duplicate", requireFeature("ai_flows"), duplicateWorkflow);
apiRoutes.delete("/ai-flows/:workflowId", requireFeature("ai_flows"), deleteWorkflow);
apiRoutes.post("/messages/send-initial", requireFeature("dashboard"), sendInitialMessages);
apiRoutes.post("/knowledge/seed", requireFeature("settings"), seedKnowledgeBase);
apiRoutes.get("/knowledge", requireFeature("settings"), listKnowledgeBase);
apiRoutes.get("/human-action-queue", requireFeature("human_queue"), getHumanActionQueue);
apiRoutes.post("/human-action-queue/:leadId/request", requireFeature("human_queue"), requestHumanAction);
apiRoutes.post("/human-action-queue/:leadId/resolve", requireFeature("human_queue"), resolveHumanAction);
apiRoutes.get("/order-pipeline", requireFeature("orders"), getOrderPipeline);
apiRoutes.patch("/orders/:orderId/status", requireFeature("orders"), updateOrderStatus);
apiRoutes.patch("/orders/:orderId", requireFeature("orders"), updateOrder);
apiRoutes.post("/orders/:orderId/action", requireFeature("orders"), performOrderAction);
