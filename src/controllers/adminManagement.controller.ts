import type { Request, Response } from "express";
import { AppUserStatus, CompanyStatus } from "@prisma/client";
import { z } from "zod";
import { adminManagementService } from "../services/adminManagement.service.js";
import { asyncHandler, AppError } from "../utils/errors.js";

const companySchema = z.object({
  name: z.string().trim().min(2),
  slug: z.string().trim().optional(),
  status: z.nativeEnum(CompanyStatus).optional(),
  logoUrl: z.string().trim().url().optional().nullable(),
  whatsappNumber: z.string().trim().optional().nullable(),
  brandColor: z.string().trim().optional().nullable(),
  timezone: z.string().trim().optional().nullable(),
  businessType: z.string().trim().optional().nullable()
});

const userSchema = z.object({
  companyId: z.string().trim().optional().nullable(),
  name: z.string().trim().min(1),
  username: z.string().trim().min(2),
  email: z.string().trim().email().optional().nullable(),
  password: z.string().min(8),
  confirmPassword: z.string().min(8),
  status: z.nativeEnum(AppUserStatus).optional()
});

const userUpdateSchema = z.object({
  companyId: z.string().trim().optional().nullable(),
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional().nullable(),
  status: z.nativeEnum(AppUserStatus).optional()
});

const resetPasswordSchema = z.object({
  password: z.string().min(8),
  confirmPassword: z.string().min(8)
});

function billingFilters(req: Request) {
  return {
    companyId: String(req.query.companyId || ""),
    from: String(req.query.from || ""),
    to: String(req.query.to || "")
  };
}

export const listCompanies = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ companies: await adminManagementService.listCompanies() });
});

export const createCompany = asyncHandler(async (req: Request, res: Response) => {
  const body = companySchema.parse(req.body);
  res.status(201).json({ company: await adminManagementService.createCompany(body) });
});

export const listUsers = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ users: await adminManagementService.listUsers() });
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const body = userSchema.parse(req.body);
  if (body.password !== body.confirmPassword) throw new AppError("Passwords do not match", 400);
  res.status(201).json({ user: await adminManagementService.createUser(body) });
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const body = userUpdateSchema.parse(req.body);
  res.json({ user: await adminManagementService.updateUser(req.params.id, body) });
});

export const resetUserPassword = asyncHandler(async (req: Request, res: Response) => {
  const body = resetPasswordSchema.parse(req.body);
  if (body.password !== body.confirmPassword) throw new AppError("Passwords do not match", 400);
  res.json({ user: await adminManagementService.resetPassword(req.params.id, body.password) });
});

export const getBilling = asyncHandler(async (req: Request, res: Response) => {
  res.json(await adminManagementService.billing(billingFilters(req)));
});

export const exportBillingCsv = asyncHandler(async (req: Request, res: Response) => {
  const csv = await adminManagementService.billingCsv(billingFilters(req));
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", "attachment; filename=api-usage.csv");
  res.send(csv);
});
