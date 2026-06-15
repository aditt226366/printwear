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

export const apiRoutes = Router();

apiRoutes.get("/dashboard", getDashboard);
apiRoutes.get("/debug/webhook-status", getWebhookStatus);
apiRoutes.get("/events", streamChatEvents);
apiRoutes.get("/leads", getLeads);
apiRoutes.get("/leads/:leadId/conversation", getConversation);
apiRoutes.post("/leads/:leadId/messages", sendManualMessage);
apiRoutes.post("/leads/import", importLeads);
apiRoutes.get("/automation/setup", getAutomationSetup);
apiRoutes.get("/contacts", listContacts);
apiRoutes.post("/contacts", createContact);
apiRoutes.post("/contacts/import/csv", importContactsCsv);
apiRoutes.post("/contacts/import/google-sheets", importContactsSheets);
apiRoutes.get("/bulk-messages", listBulkJobs);
apiRoutes.post("/bulk-messages", createBulkSend);
apiRoutes.get("/campaigns", listCampaigns);
apiRoutes.post("/campaigns", createCampaign);
apiRoutes.get("/campaigns/:campaignId", getCampaign);
apiRoutes.post("/campaigns/:campaignId/pause", pauseCampaign);
apiRoutes.post("/campaigns/:campaignId/cancel", cancelCampaign);
apiRoutes.get("/ads", listAdDrafts);
apiRoutes.post("/ads", createAdDraft);
apiRoutes.get("/ai-flows", listWorkflows);
apiRoutes.post("/ai-flows", createWorkflow);
apiRoutes.patch("/ai-flows/:workflowId", updateWorkflow);
apiRoutes.post("/messages/send-initial", sendInitialMessages);
apiRoutes.post("/knowledge/seed", seedKnowledgeBase);
apiRoutes.get("/knowledge", listKnowledgeBase);
apiRoutes.get("/human-action-queue", getHumanActionQueue);
apiRoutes.post("/human-action-queue/:leadId/request", requestHumanAction);
apiRoutes.post("/human-action-queue/:leadId/resolve", resolveHumanAction);
apiRoutes.get("/order-pipeline", getOrderPipeline);
apiRoutes.patch("/orders/:orderId/status", updateOrderStatus);
apiRoutes.patch("/orders/:orderId", updateOrder);
apiRoutes.post("/orders/:orderId/action", performOrderAction);
