import { Router } from "express";
import { login, logout, showLogin } from "../controllers/auth.controller.js";
import { showDashboard } from "../controllers/dashboard.controller.js";
import { requireAdmin } from "../middleware/auth.middleware.js";

export const authRoutes = Router();

authRoutes.get("/login", showLogin);
authRoutes.post("/login", login);
authRoutes.post("/logout", logout);
authRoutes.get("/dashboard", requireAdmin, showDashboard);
