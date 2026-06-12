import { Router } from "express";
import {
  getDashboard,
  getConversation,
  getHumanActionQueue,
  getLeads,
  getOrderPipeline,
  performOrderAction,
  resolveHumanAction,
  streamChatEvents,
  updateOrder,
  updateOrderStatus
} from "../controllers/admin.controller.js";
import { importLeads } from "../controllers/leads.controller.js";
import { listKnowledgeBase, seedKnowledgeBase } from "../controllers/knowledge.controller.js";
import { sendInitialMessages } from "../controllers/messages.controller.js";

export const apiRoutes = Router();

apiRoutes.get("/dashboard", getDashboard);
apiRoutes.get("/events", streamChatEvents);
apiRoutes.get("/leads", getLeads);
apiRoutes.get("/leads/:leadId/conversation", getConversation);
apiRoutes.post("/leads/import", importLeads);
apiRoutes.post("/messages/send-initial", sendInitialMessages);
apiRoutes.post("/knowledge/seed", seedKnowledgeBase);
apiRoutes.get("/knowledge", listKnowledgeBase);
apiRoutes.get("/human-action-queue", getHumanActionQueue);
apiRoutes.post("/human-action-queue/:leadId/resolve", resolveHumanAction);
apiRoutes.get("/order-pipeline", getOrderPipeline);
apiRoutes.patch("/orders/:orderId/status", updateOrderStatus);
apiRoutes.patch("/orders/:orderId", updateOrder);
apiRoutes.post("/orders/:orderId/action", performOrderAction);
