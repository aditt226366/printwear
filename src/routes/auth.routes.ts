import { Router } from "express";
import { login, logout, logoutJson, showLogin } from "../controllers/auth.controller.js";
import { showAdminPanel, showDashboard } from "../controllers/dashboard.controller.js";
import { requireAdmin, requireSession } from "../middleware/auth.middleware.js";

export const authRoutes = Router();

authRoutes.get("/login", showLogin);
authRoutes.post("/login", login);
authRoutes.post("/auth/login", login);
authRoutes.post("/auth/logout", logoutJson);
authRoutes.post("/logout", logout);
authRoutes.get("/admin", requireAdmin, showAdminPanel);
authRoutes.get("/dashboard", requireSession, showDashboard);
