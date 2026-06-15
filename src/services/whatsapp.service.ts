import { MessageStatus, MessageType } from "@prisma/client";
import { env, requireEnv } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

type WhatsAppSendResponse = {
  messages?: Array<{ id?: string }>;
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
};

type TemplateParameter = {
  type: "text";
  text: string;
};

export type ParsedIncomingMessage = {
  messageId: string;
  from: string;
  profileName?: string;
  type: keyof typeof MessageType;
  content: string;
  rawPayload: unknown;
};

export type ParsedStatusUpdate = {
  messageId: string;
  recipientId?: string;
  status: keyof typeof MessageStatus;
  rawPayload: unknown;
};

function endpoint() {
  const phoneNumberId = requireEnv("WHATSAPP_PHONE_NUMBER_ID");
  return `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;
}

export function validateWhatsAppConfig() {
  const missing = [
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_TEMPLATE_NAME",
    "WHATSAPP_TEMPLATE_LANGUAGE"
  ].filter((name) => !String(env[name as keyof typeof env] ?? "").trim());

  if (missing.length) {
    throw new AppError("WhatsApp configuration is incomplete", 400, `Missing ${missing.join(", ")}`);
  }

  return {
    accessToken: requireEnv("WHATSAPP_ACCESS_TOKEN").trim(),
    phoneNumberId: requireEnv("WHATSAPP_PHONE_NUMBER_ID"),
    templateName: requireEnv("WHATSAPP_TEMPLATE_NAME").trim(),
    templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE.trim()
  };
}

function statusFromMeta(status: string): keyof typeof MessageStatus {
  switch (status) {
    case "sent":
      return "SENT";
    case "delivered":
      return "DELIVERED";
    case "read":
      return "READ";
    case "failed":
      return "FAILED";
    default:
      return "PENDING";
  }
}

function typeFromMeta(type: string): keyof typeof MessageType {
  switch (type) {
    case "image":
      return "IMAGE";
    case "video":
      return "VIDEO";
    case "document":
      return "DOCUMENT";
    case "audio":
      return "AUDIO";
    default:
      return "TEXT";
  }
}

function extractContent(message: Record<string, unknown>, type: string): string {
  if (type === "text") {
    const text = message.text as { body?: string } | undefined;
    return text?.body ?? "";
  }

  const media = message[type] as { caption?: string; id?: string; filename?: string } | undefined;
  return media?.caption ?? media?.filename ?? `[${type} message${media?.id ? `: ${media.id}` : ""}]`;
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postToWhatsApp(body: unknown, attempt = 1): Promise<{ messageId?: string; rawResponse: unknown }> {
  const config = validateWhatsAppConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const requestBody = body as { type?: string; to?: string; template?: { name?: string; language?: { code?: string } } };

  try {
    logger.info(
      {
        attempt,
        type: requestBody.type,
        to: requestBody.to,
        templateName: requestBody.template?.name,
        templateLanguage: requestBody.template?.language?.code
      },
      "Sending WhatsApp API request"
    );

    const response = await fetch(endpoint(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const json = (await response.json().catch(() => ({}))) as WhatsAppSendResponse;
    logger.info(
      {
        status: response.status,
        ok: response.ok,
        messageId: json.messages?.[0]?.id,
        error: json.error
      },
      "WhatsApp API response received"
    );

    if (!response.ok) {
      const retriable = response.status >= 500 || response.status === 429;
      if (retriable && attempt < 3) {
        await delay(500 * attempt);
        return postToWhatsApp(body, attempt + 1);
      }

      throw new AppError(
        "WhatsApp API request failed",
        response.status >= 400 && response.status < 500 ? 400 : 500,
        json.error?.message ?? `WhatsApp API failed with status ${response.status}`
      );
    }

    return {
      messageId: json.messages?.[0]?.id,
      rawResponse: json
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (attempt < 3) {
      await delay(500 * attempt);
      return postToWhatsApp(body, attempt + 1);
    }

    logger.error({ error, attempt }, "WhatsApp API request failed");
    throw new AppError(
      "WhatsApp API request failed",
      500,
      error instanceof Error ? error.message : "Unknown WhatsApp API error"
    );
  } finally {
    clearTimeout(timeout);
  }
}

export const whatsappService = {
  async sendNamedTemplateMessage(input: {
    phone: string;
    templateName: string;
    templateLanguage?: string;
    parameters?: TemplateParameter[];
  }) {
    const config = validateWhatsAppConfig();
    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      to: input.phone,
      type: "template",
      template: {
        name: input.templateName.trim() || config.templateName,
        language: {
          code: input.templateLanguage?.trim() || config.templateLanguage
        }
      }
    };

    if (input.parameters?.length) {
      body.template = {
        ...(body.template as Record<string, unknown>),
        components: [
          {
            type: "body",
            parameters: input.parameters
          }
        ]
      };
    }

    return postToWhatsApp(body);
  },

  async sendTemplateMessage(phone: string, name: string) {
    const config = validateWhatsAppConfig();
    return this.sendNamedTemplateMessage({
      phone,
      templateName: config.templateName,
      templateLanguage: config.templateLanguage,
      parameters: [
        {
          type: "text",
          text: name
        }
      ]
    });
  },

  async sendTextMessage(phone: string, text: string) {
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "text",
      text: {
        preview_url: false,
        body: text
      }
    };

    return postToWhatsApp(body);
  },

  parseIncomingWebhook(payload: unknown): ParsedIncomingMessage[] {
    const parsed: ParsedIncomingMessage[] = [];
    const entries = (payload as { entry?: unknown[] })?.entry ?? [];

    for (const entry of entries) {
      const changes = (entry as { changes?: unknown[] }).changes ?? [];
      for (const change of changes) {
        const value = (change as { value?: Record<string, unknown> }).value;
        const messages = (value?.messages as Array<Record<string, unknown>> | undefined) ?? [];
        const contacts = (value?.contacts as Array<{ wa_id?: string; profile?: { name?: string } }> | undefined) ?? [];

        for (const message of messages) {
          const id = String(message.id ?? "");
          const from = String(message.from ?? "");
          const type = String(message.type ?? "text");
          const contact = contacts.find((item) => item.wa_id === from);

          if (!id || !from) {
            continue;
          }

          parsed.push({
            messageId: id,
            from,
            profileName: contact?.profile?.name,
            type: typeFromMeta(type),
            content: extractContent(message, type),
            rawPayload: message
          });
        }
      }
    }

    return parsed;
  },

  parseStatusWebhook(payload: unknown): ParsedStatusUpdate[] {
    const parsed: ParsedStatusUpdate[] = [];
    const entries = (payload as { entry?: unknown[] })?.entry ?? [];

    for (const entry of entries) {
      const changes = (entry as { changes?: unknown[] }).changes ?? [];
      for (const change of changes) {
        const value = (change as { value?: Record<string, unknown> }).value;
        const statuses = (value?.statuses as Array<Record<string, unknown>> | undefined) ?? [];

        for (const status of statuses) {
          const id = String(status.id ?? "");
          if (!id) {
            continue;
          }

          parsed.push({
            messageId: id,
            recipientId: status.recipient_id ? String(status.recipient_id) : undefined,
            status: statusFromMeta(String(status.status ?? "")),
            rawPayload: status
          });
        }
      }
    }

    return parsed;
  }
};
