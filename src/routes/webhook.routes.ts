import { Router } from "express";
import { receiveWebhook, verifyWebhook } from "../controllers/webhook.controller.js";

export const webhookRoutes = Router();

webhookRoutes.get("/", verifyWebhook);
webhookRoutes.post("/", receiveWebhook);
