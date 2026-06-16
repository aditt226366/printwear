import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger.js";

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 500,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(`Route not found: ${req.method} ${req.path}`, 404));
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const requestError = error as { status?: number; statusCode?: number; type?: string; message?: string };
  if (!(error instanceof AppError) && (requestError.type === "entity.parse.failed" || requestError.status === 400 || requestError.statusCode === 400)) {
    res.status(400).json({ error: requestError.message ?? "Invalid request body" });
    return;
  }

  if ((error as { name?: string }).name === "MulterError") {
    res.status(400).json({ error: error instanceof Error ? error.message : "Upload failed" });
    return;
  }

  if (error instanceof ZodError) {
    const fieldErrors = error.issues.reduce<Record<string, string>>((errors, issue) => {
      const key = String(issue.path[0] || "form");
      if (!errors[key]) errors[key] = issue.message;
      return errors;
    }, {});
    const message = Object.values(fieldErrors)[0] || "Please check the highlighted fields.";
    res.status(400).json({
      error: message,
      fieldErrors,
      details: error.flatten()
    });
    return;
  }

  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error({ error }, error.message);
    }

    res.status(error.statusCode).json({
      error: error.message,
      ...((error.details as { fieldErrors?: unknown } | undefined)?.fieldErrors ? { fieldErrors: (error.details as { fieldErrors: unknown }).fieldErrors } : {}),
      details: error.details
    });
    return;
  }

  logger.error({ error }, "Unhandled server error");
  res.status(500).json({ error: "Internal server error" });
}
