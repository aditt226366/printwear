import type { Request, Response } from "express";
import { AppUserStatus } from "@prisma/client";
import { z } from "zod";
import { adminManagementService } from "../services/adminManagement.service.js";
import { asyncHandler, AppError } from "../utils/errors.js";

const statusValues = ["ACTIVE", "INACTIVE"] as const;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
type FieldErrors = Record<string, string>;

function parseAdminBody<T>(schema: z.ZodType<T>, body: unknown, fieldMap: Record<string, string>) {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;

  const fieldErrors = parsed.error.issues.reduce<FieldErrors>((errors, issue) => {
    const rawKey = String(issue.path[0] || "form");
    const key = fieldMap[rawKey] || rawKey;
    if (!errors[key]) errors[key] = issue.message;
    return errors;
  }, {});
  const message = Object.values(fieldErrors)[0] || "Please check the highlighted fields.";
  throw new AppError(message, 400, { fieldErrors });
}

const companySchema = z.object({
  name: z.string({ required_error: "Company name must be at least 2 characters.", invalid_type_error: "Company name must be at least 2 characters." }).trim().min(2, "Company name must be at least 2 characters."),
  slug: z.string({ invalid_type_error: "Slug must be at least 2 characters and use lowercase letters, numbers, or hyphens." })
    .trim()
    .optional()
    .transform((value) => value || undefined)
    .pipe(
      z.string({ invalid_type_error: "Slug must be at least 2 characters and use lowercase letters, numbers, or hyphens." })
      .trim()
      .min(2, "Slug must be at least 2 characters and use lowercase letters, numbers, or hyphens.")
      .regex(slugPattern, "Slug must be at least 2 characters and use lowercase letters, numbers, or hyphens.")
      .optional()
    ),
  status: z.enum(statusValues, { invalid_type_error: "Select a valid status.", required_error: "Select a valid status." }).optional(),
  logoUrl: z.string().trim().url().optional().nullable(),
  whatsappNumber: z.string().trim().optional().nullable(),
  brandColor: z.string().trim().optional().nullable(),
  timezone: z.string().trim().optional().nullable(),
  businessType: z.string().trim().optional().nullable()
});

const userSchema = z.object({
  companyId: z.string({ required_error: "Select a company.", invalid_type_error: "Select a company." }).trim().min(1, "Select a company."),
  name: z.string({ required_error: "Name is required.", invalid_type_error: "Name is required." }).trim().min(1, "Name is required."),
  username: z.string({ required_error: "Username must be at least 2 characters.", invalid_type_error: "Username must be at least 2 characters." }).trim().min(2, "Username must be at least 2 characters."),
  email: z.string().trim().email("Enter a valid email address.").optional().nullable(),
  password: z.string({ required_error: "Password must be at least 8 characters.", invalid_type_error: "Password must be at least 8 characters." }).min(8, "Password must be at least 8 characters."),
  confirmPassword: z.string({ required_error: "Confirm password must match password.", invalid_type_error: "Confirm password must match password." }).min(8, "Confirm password must match password."),
  status: z.enum(statusValues, { invalid_type_error: "Select a valid status.", required_error: "Select a valid status." }).optional()
}).refine((body) => body.password === body.confirmPassword, {
  path: ["confirmPassword"],
  message: "Confirm password must match password."
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
  const body = parseAdminBody(companySchema, req.body, { name: "companyName" });
  res.status(201).json({ company: await adminManagementService.createCompany(body) });
});

export const listUsers = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ users: await adminManagementService.listUsers() });
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const body = parseAdminBody(userSchema, req.body, {});
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
