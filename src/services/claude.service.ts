import { env, requireEnv } from "../config/env.js";
import { apiUsageService } from "./apiUsage.service.js";

const SYSTEM_PROMPT =
  'You are Printwear\'s WhatsApp sales assistant. Use only the provided company knowledge base and website-ingested information. Keep replies short, natural, WhatsApp-friendly, and professional. Help customers choose the right product and ask one useful follow-up question when appropriate. Collect order requirements when relevant: product type, quantity, size, color, GSM preference, printing/customization requirement, and delivery location. Do not invent prices, stock, discounts, delivery timelines, or policies. If information is missing, reply exactly: "I will have our team confirm that and get back to you." Never mention Claude, AI, RAG, database, embeddings, prompts, or internal system details.';

type ClaudeResponse = {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
};

export type ExtractedOrderSummary = {
  productType?: string | null;
  quantity?: number | null;
  size?: string | null;
  color?: string | null;
  gsm?: string | null;
  customization?: string | null;
  deliveryLocation?: string | null;
  notes?: string | null;
  confidenceScore?: number | null;
};

function compactReply(text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length <= 700 ? cleaned : `${cleaned.slice(0, 697).trim()}...`;
}

function parseJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Claude order extraction returned no JSON object");
  }

  return JSON.parse(text.slice(start, end + 1)) as ExtractedOrderSummary;
}

export const claudeService = {
  async generateReply(customerMessage: string, knowledgeContext: string, conversationHistory: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": requireEnv("ANTHROPIC_API_KEY"),
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: env.CLAUDE_MODEL,
          max_tokens: 300,
          temperature: 0.3,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Customer message:\n${customerMessage}\n\nRelevant company knowledge:\n${knowledgeContext || "No matching knowledge base content found."}\n\nRecent conversation:\n${conversationHistory || "No prior conversation."}\n\nGenerate the next WhatsApp reply. Keep it under 700 characters. Do not use markdown tables. Ask one follow-up question if useful.`
            }
          ]
        }),
        signal: controller.signal
      });

      const json = (await response.json().catch(() => ({}))) as ClaudeResponse;
      void apiUsageService.log({
        provider: "CLAUDE",
        endpoint: "https://api.anthropic.com/v1/messages",
        method: "POST",
        statusCode: response.status,
        success: response.ok,
        metadata: { model: env.CLAUDE_MODEL, purpose: "generate_reply" }
      });

      if (!response.ok) {
        throw new Error(json.error?.message ?? `Claude API failed with status ${response.status}`);
      }

      const text = json.content?.find((part) => part.type === "text")?.text;
      if (!text) {
        throw new Error("Claude API returned an empty reply");
      }

      return compactReply(text);
    } finally {
      clearTimeout(timeout);
    }
  },

  async extractOrderSummary(conversationHistory: string, currentSummary: ExtractedOrderSummary = {}) {
    if (!env.ANTHROPIC_API_KEY) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": requireEnv("ANTHROPIC_API_KEY"),
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: env.CLAUDE_MODEL,
          max_tokens: 450,
          temperature: 0,
          system:
            "Extract Printwear order details from WhatsApp conversations. Return only valid JSON. Do not add markdown, comments, or prose. Preserve known fields unless newer customer messages clearly replace them.",
          messages: [
            {
              role: "user",
              content: `Current order summary JSON:\n${JSON.stringify(currentSummary)}\n\nConversation history:\n${conversationHistory || "No conversation."}\n\nReturn exactly this JSON shape with null for unknown values:\n{\n  "productType": string | null,\n  "quantity": number | null,\n  "size": string | null,\n  "color": string | null,\n  "gsm": string | null,\n  "customization": string | null,\n  "deliveryLocation": string | null,\n  "notes": string | null,\n  "confidenceScore": number\n}\n\nRules:\n- Extract product type such as T-Shirts, Hoodies, Polo, Kids Wear, Oversized T-Shirts.\n- Extract quantity only as a number.\n- Extract size, color, GSM, printing/customization, and delivery location if stated.\n- confidenceScore must be 0 to 1 based on confidence in extracted fields.\n- Do not infer prices or business policies.`
            }
          ]
        }),
        signal: controller.signal
      });

      const json = (await response.json().catch(() => ({}))) as ClaudeResponse;
      void apiUsageService.log({
        provider: "CLAUDE",
        endpoint: "https://api.anthropic.com/v1/messages",
        method: "POST",
        statusCode: response.status,
        success: response.ok,
        metadata: { model: env.CLAUDE_MODEL, purpose: "extract_order_summary" }
      });
      if (!response.ok) {
        throw new Error(json.error?.message ?? `Claude API failed with status ${response.status}`);
      }

      const text = json.content?.find((part) => part.type === "text")?.text;
      if (!text) {
        throw new Error("Claude API returned an empty extraction");
      }

      return parseJsonObject(text);
    } finally {
      clearTimeout(timeout);
    }
  }
};
