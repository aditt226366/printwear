import { MessageStatus, MessageType } from "@prisma/client";
import { env, requireEnv } from "../config/env.js";

type WhatsAppSendResponse = {
  messages?: Array<{ id?: string }>;
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("WHATSAPP_ACCESS_TOKEN")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const json = (await response.json().catch(() => ({}))) as WhatsAppSendResponse;

    if (!response.ok) {
      const retriable = response.status >= 500 || response.status === 429;
      if (retriable && attempt < 3) {
        await delay(500 * attempt);
        return postToWhatsApp(body, attempt + 1);
      }

      throw new Error(json.error?.message ?? `WhatsApp API failed with status ${response.status}`);
    }

    return {
      messageId: json.messages?.[0]?.id,
      rawResponse: json
    };
  } catch (error) {
    if (attempt < 3) {
      await delay(500 * attempt);
      return postToWhatsApp(body, attempt + 1);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const whatsappService = {
  async sendTemplateMessage(phone: string, name: string) {
    const body = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: requireEnv("WHATSAPP_TEMPLATE_NAME").trim(),
        language: {
          code: env.WHATSAPP_TEMPLATE_LANGUAGE.trim()
        },
        components: [
          {
            type: "body",
            parameters: [
              {
                type: "text",
                text: name
              }
            ]
          }
        ]
      }
    };

    return postToWhatsApp(body);
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
