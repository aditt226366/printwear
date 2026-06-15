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
  cancelCampaign,
  createAdDraft,
  createBulkSend,
  createCampaign,
  createContact,
  createWorkflow,
  getCampaign,
  getAutomationSetup,
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

export const apiRoutes = Router();

apiRoutes.get("/automation/setup", getAutomationSetup);

apiRoutes.use(requireSession);

apiRoutes.get("/session", getSession);
apiRoutes.get("/features/enabled", getEnabledFeatures);
apiRoutes.get("/admin/features", requireAdmin, getAdminFeatures);
apiRoutes.patch("/admin/features/:key", requireAdmin, updateAdminFeature);

apiRoutes.get("/dashboard", getDashboard);
apiRoutes.get("/debug/webhook-status", requireFeature("settings"), getWebhookStatus);
apiRoutes.get("/events", requireFeature("chats"), streamChatEvents);
apiRoutes.get("/leads", requireFeature("chats"), getLeads);
apiRoutes.get("/leads/:leadId/conversation", requireFeature("chats"), getConversation);
apiRoutes.post("/leads/:leadId/messages", requireFeature("chats"), sendManualMessage);
apiRoutes.post("/leads/import", requireFeature("overview"), importLeads);
apiRoutes.get("/contacts", requireFeature("contacts"), listContacts);
apiRoutes.post("/contacts", requireFeature("contacts"), createContact);
apiRoutes.post("/contacts/import/csv", requireFeature("contacts"), importContactsCsv);
apiRoutes.post("/contacts/import/google-sheets", requireFeature("contacts"), importContactsSheets);
apiRoutes.get("/bulk-messages", requireFeature("contacts"), listBulkJobs);
apiRoutes.post("/bulk-messages", requireFeature("contacts"), createBulkSend);
apiRoutes.get("/campaigns", requireFeature("campaigns"), listCampaigns);
apiRoutes.post("/campaigns", requireFeature("campaigns"), createCampaign);
apiRoutes.get("/campaigns/:campaignId", requireFeature("campaigns"), getCampaign);
apiRoutes.post("/campaigns/:campaignId/pause", requireFeature("campaigns"), pauseCampaign);
apiRoutes.post("/campaigns/:campaignId/cancel", requireFeature("campaigns"), cancelCampaign);
apiRoutes.get("/ads", requireFeature("ads"), listAdDrafts);
apiRoutes.post("/ads", requireFeature("ads"), createAdDraft);
apiRoutes.get("/ai-flows", requireFeature("flows"), listWorkflows);
apiRoutes.post("/ai-flows", requireFeature("flows"), createWorkflow);
apiRoutes.patch("/ai-flows/:workflowId", requireFeature("flows"), updateWorkflow);
apiRoutes.post("/messages/send-initial", requireFeature("overview"), sendInitialMessages);
apiRoutes.post("/knowledge/seed", requireFeature("settings"), seedKnowledgeBase);
apiRoutes.get("/knowledge", requireFeature("settings"), listKnowledgeBase);
apiRoutes.get("/human-action-queue", requireFeature("human"), getHumanActionQueue);
apiRoutes.post("/human-action-queue/:leadId/request", requireFeature("human"), requestHumanAction);
apiRoutes.post("/human-action-queue/:leadId/resolve", requireFeature("human"), resolveHumanAction);
apiRoutes.get("/order-pipeline", requireFeature("orders"), getOrderPipeline);
apiRoutes.patch("/orders/:orderId/status", requireFeature("orders"), updateOrderStatus);
apiRoutes.patch("/orders/:orderId", requireFeature("orders"), updateOrder);
apiRoutes.post("/orders/:orderId/action", requireFeature("orders"), performOrderAction);
