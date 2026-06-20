import { Router } from "express";
import { login, logout, logoutJson, showLogin } from "../controllers/auth.controller.js";
import { showAdminPanel, showDashboard } from "../controllers/dashboard.controller.js";
import { requireAdmin, requireUser } from "../middleware/auth.middleware.js";
import { requireFeature } from "../middleware/feature.middleware.js";

export const authRoutes = Router();

authRoutes.get("/login", showLogin);
authRoutes.post("/login", login);
authRoutes.post("/auth/login", login);
authRoutes.post("/auth/logout", logoutJson);
authRoutes.post("/logout", logout);
authRoutes.get("/admin", requireAdmin, showAdminPanel);
authRoutes.get("/admin/integrations", requireAdmin, showAdminPanel);
authRoutes.get("/dashboard", requireUser, showDashboard);
authRoutes.get("/command-center", requireUser, showDashboard);
authRoutes.get("/app/dashboard", requireUser, showDashboard);
authRoutes.get("/app/inbox", requireUser, showDashboard);
authRoutes.get("/app/leads", requireUser, showDashboard);
authRoutes.get("/app/ads", requireUser, requireFeature("ads"), showDashboard);
authRoutes.get("/app/orders", requireUser, showDashboard);
authRoutes.get("/app/human-queue", requireUser, showDashboard);
authRoutes.get("/app/knowledge-base", requireUser, showDashboard);
authRoutes.get("/app/settings", requireUser, showDashboard);
