import { Router } from "express";
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
  getCompanyIntegration,
  getIntegrationStatus,
  testGoogleSheetsIntegration,
  testMetaAdsIntegration,
  testWhatsAppIntegration,
  updateCompanyIntegration
} from "../controllers/companyIntegration.controller.js";
import {
  cancelCampaign,
  createAdDraft,
  createBulkSend,
  createCampaign,
  createContact,
  createWorkflow,
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
  updateWorkflow
} from "../controllers/automation.controller.js";
import { requireAdmin, requireSession } from "../middleware/auth.middleware.js";
import { requireFeature } from "../middleware/feature.middleware.js";
import { getDatabaseSchema, getSystemStatus } from "../controllers/systemStatus.controller.js";
import { getGoogleSheetsStatus } from "../controllers/googleSheets.controller.js";

export const apiRoutes = Router();

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
apiRoutes.get("/admin/company-integrations", requireAdmin, getCompanyIntegration);
apiRoutes.put("/admin/company-integrations", requireAdmin, updateCompanyIntegration);
apiRoutes.post("/admin/company-integrations/:companyId/test/whatsapp", requireAdmin, testWhatsAppIntegration);
apiRoutes.post("/admin/company-integrations/:companyId/test/google-sheets", requireAdmin, testGoogleSheetsIntegration);
apiRoutes.post("/admin/company-integrations/:companyId/test/meta-ads", requireAdmin, testMetaAdsIntegration);

apiRoutes.get("/dashboard", getDashboard);
apiRoutes.get("/integrations/status", getIntegrationStatus);
apiRoutes.get("/debug/database-schema", requireAdmin, getDatabaseSchema);
apiRoutes.get("/debug/google-sheets-status", requireAdmin, getGoogleSheetsStatus);
apiRoutes.get("/debug/webhook-status", requireFeature("settings"), getWebhookStatus);
apiRoutes.get("/events", requireFeature("chats"), streamChatEvents);
apiRoutes.get("/leads", requireFeature("chats"), getLeads);
apiRoutes.get("/leads/:leadId/conversation", requireFeature("chats"), getConversation);
apiRoutes.post("/leads/:leadId/messages", requireFeature("chats"), sendManualMessage);
apiRoutes.post("/leads/import", requireFeature("dashboard"), importLeads);
apiRoutes.get("/contacts", requireFeature("contacts_broadcasts"), listContacts);
apiRoutes.post("/contacts", requireFeature("contacts_broadcasts"), createContact);
apiRoutes.post("/contacts/import/csv", requireFeature("contacts_broadcasts"), importContactsCsv);
apiRoutes.post("/contacts/import/google-sheets", requireFeature("contacts_broadcasts"), importContactsSheets);
apiRoutes.get("/bulk-messages", requireFeature("contacts_broadcasts"), listBulkJobs);
apiRoutes.post("/bulk-messages", requireFeature("contacts_broadcasts"), createBulkSend);
apiRoutes.get("/campaigns", requireFeature("campaigns"), listCampaigns);
apiRoutes.post("/campaigns", requireFeature("campaigns"), createCampaign);
apiRoutes.get("/campaigns/:campaignId", requireFeature("campaigns"), getCampaign);
apiRoutes.post("/campaigns/:campaignId/pause", requireFeature("campaigns"), pauseCampaign);
apiRoutes.post("/campaigns/:campaignId/cancel", requireFeature("campaigns"), cancelCampaign);
apiRoutes.get("/ads", requireFeature("ads"), listAdDrafts);
apiRoutes.get("/ads/status", requireFeature("ads"), getAdsStatus);
apiRoutes.post("/ads", requireFeature("ads"), createAdDraft);
apiRoutes.get("/ai-flows", requireFeature("ai_flows"), listWorkflows);
apiRoutes.post("/ai-flows", requireFeature("ai_flows"), createWorkflow);
apiRoutes.patch("/ai-flows/:workflowId", requireFeature("ai_flows"), updateWorkflow);
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
