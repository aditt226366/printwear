import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().optional(),

  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  SESSION_SECRET: z.string().min(32).optional(),

  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_TEMPLATE_NAME: z.string().optional(),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default("en_US"),
  WHATSAPP_API_VERSION: z.string().default("v20.0"),
  AUTOMATION_SEND_DELAY_MS: z.coerce.number().int().min(250).max(60000).default(1200),
  AUTOMATION_WORKERS_ENABLED: z.coerce.boolean().default(true),
  META_ADS_ACCESS_TOKEN: z.string().optional(),
  META_AD_ACCOUNT_ID: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default("claude-sonnet-4-6"),

  GOOGLE_SHEETS_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_SHEETS_RANGE: z.string().default("Sheet1!A:C"),
  GOOGLE_SHEETS_STATUS_COLUMN: z.string().default("C"),

  PRINTWEAR_WEBSITE_URL: z.string().url().default("https://printwear.in"),
  KNOWLEDGE_CRAWL_MAX_PAGES: z.coerce.number().int().positive().max(50).default(12),
  KNOWLEDGE_CHUNK_SIZE: z.coerce.number().int().positive().max(4000).default(1200),

  LOG_LEVEL: z.string().default("info")
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const details = parsedEnv.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = parsedEnv.data;

export function requireEnv(name: keyof typeof env): string {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
