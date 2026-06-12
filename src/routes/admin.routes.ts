import { Router } from "express";
import multer from "multer";
import {
  createKnowledge,
  deleteKnowledge,
  getConversation,
  getEnums,
  getHumanActionQueue,
  getKnowledge,
  getLeads,
  getLogs,
  getOrderPipeline,
  getOverview,
  importLeads,
  ingestWebsiteKnowledge,
  performOrderAction,
  resolveHumanAction,
  sendInitialMessages,
  sendManualMessage,
  streamChatEvents,
  syncPrintwearWebsiteKnowledge,
  updateOrder,
  updateOrderStatus,
  uploadKnowledgeDocument,
  updateKnowledge
} from "../controllers/admin.controller.js";
import { requireAdmin } from "../middleware/auth.middleware.js";
import { AppError } from "../utils/errors.js";

export const adminRoutes = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter(_req, file, callback) {
    const allowedTypes = new Set([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain"
    ]);

    if (allowedTypes.has(file.mimetype)) {
      callback(null, true);
      return;
    }

    callback(new AppError("Only PDF, DOCX, and TXT files are supported", 400));
  }
});

adminRoutes.use(requireAdmin);

adminRoutes.get("/events", streamChatEvents);
adminRoutes.get("/overview", getOverview);
adminRoutes.get("/human-action-queue", getHumanActionQueue);
adminRoutes.post("/human-action-queue/:leadId/resolve", resolveHumanAction);
adminRoutes.get("/order-pipeline", getOrderPipeline);
adminRoutes.patch("/orders/:orderId/status", updateOrderStatus);
adminRoutes.patch("/orders/:orderId", updateOrder);
adminRoutes.post("/orders/:orderId/action", performOrderAction);
adminRoutes.get("/leads", getLeads);
adminRoutes.get("/leads/:leadId/conversation", getConversation);
adminRoutes.post("/leads/:leadId/messages", sendManualMessage);
adminRoutes.post("/actions/import-leads", importLeads);
adminRoutes.post("/actions/send-initial", sendInitialMessages);
adminRoutes.get("/knowledge", getKnowledge);
adminRoutes.post("/knowledge", createKnowledge);
adminRoutes.post("/knowledge/ingest-url", ingestWebsiteKnowledge);
adminRoutes.post("/knowledge/sync-printwear", syncPrintwearWebsiteKnowledge);
adminRoutes.post("/knowledge/upload", upload.single("document"), uploadKnowledgeDocument);
adminRoutes.put("/knowledge/:id", updateKnowledge);
adminRoutes.delete("/knowledge/:id", deleteKnowledge);
adminRoutes.get("/logs", getLogs);
adminRoutes.get("/enums", getEnums);
