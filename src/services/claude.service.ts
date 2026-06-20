import { env } from "../config/env.js";
import { localIntegrationFallbackEnabled } from "../utils/integrationConfig.js";
import { apiUsageService } from "./apiUsage.service.js";
import { companyIntegrationService, type AiModelCredentials } from "./companyIntegration.service.js";

const SYSTEM_PROMPT =
  'You are the company\'s WhatsApp sales assistant. Use only the provided company knowledge base and website-ingested information. Keep replies short, natural, WhatsApp-friendly, and professional. Help customers choose the right product and ask one useful follow-up question when appropriate. Collect order requirements when relevant: product type, quantity, size, color, GSM preference, printing/customization requirement, and delivery location. Do not invent prices, stock, discounts, delivery timelines, or policies. If information is missing, reply exactly: "I will have our team confirm that and get back to you." Never mention AI, RAG, database, embeddings, prompts, or internal system details.';

type ClaudeResponse = {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
};

type OpenAICompatibleResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
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

function customChatCompletionsUrl(baseUrl?: string | null) {
  const url = new URL(baseUrl || "");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/chat/completions`;
  return url.toString();
}

function endpointFor(config: AiModelCredentials) {
  if (config.provider === "OPENAI") return "https://api.openai.com/v1/chat/completions";
  if (config.provider === "ANTHROPIC") return "https://api.anthropic.com/v1/messages";
  if (config.provider === "GEMINI") return `https://generativelanguage.googleapis.com/v1beta/models/${config.modelName}:generateContent`;
  return customChatCompletionsUrl(config.baseUrl);
}

async function generateWithAiModel(input: {
  config: AiModelCredentials;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  companyId?: string | null;
  purpose: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const endpoint = endpointFor(input.config);

  try {
    let response: Response;
    if (input.config.provider === "ANTHROPIC") {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "x-api-key": input.config.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: input.config.modelName,
          max_tokens: input.maxTokens,
          temperature: input.temperature,
          system: input.system,
          messages: [{ role: "user", content: input.user }]
        }),
        signal: controller.signal
      });

      const json = (await response.json().catch(() => ({}))) as ClaudeResponse;
      await apiUsageService.log({
        companyId: input.companyId,
        provider: "CLAUDE",
        endpoint: "anthropic.messages",
        method: "POST",
        statusCode: response.status,
        success: response.ok,
        metadata: { model: input.config.modelName, purpose: input.purpose }
      });
      if (!response.ok) throw new Error(json.error?.message ?? `AI API failed with status ${response.status}`);
      return json.content?.find((part) => part.type === "text")?.text ?? "";
    }

    if (input.config.provider === "GEMINI") {
      const url = new URL(endpoint);
      url.searchParams.set("key", input.config.apiKey);
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ parts: [{ text: input.user }] }],
          generationConfig: { maxOutputTokens: input.maxTokens, temperature: input.temperature }
        }),
        signal: controller.signal
      });

      const json = (await response.json().catch(() => ({}))) as GeminiResponse;
      await apiUsageService.log({
        companyId: input.companyId,
        provider: "INTERNAL",
        endpoint: "gemini.generateContent",
        method: "POST",
        statusCode: response.status,
        success: response.ok,
        metadata: { model: input.config.modelName, purpose: input.purpose, aiProvider: "GEMINI" }
      });
      if (!response.ok) throw new Error(json.error?.message ?? `AI API failed with status ${response.status}`);
      return json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
    }

    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: input.config.modelName,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user }
        ]
      }),
      signal: controller.signal
    });

    const json = (await response.json().catch(() => ({}))) as OpenAICompatibleResponse;
    await apiUsageService.log({
      companyId: input.companyId,
      provider: "INTERNAL",
      endpoint: input.config.provider === "OPENAI" ? "openai.chat.completions" : "custom.chat.completions",
      method: "POST",
      statusCode: response.status,
      success: response.ok,
      metadata: { model: input.config.modelName, purpose: input.purpose, aiProvider: input.config.provider }
    });
    if (!response.ok) throw new Error(json.error?.message ?? `AI API failed with status ${response.status}`);
    return json.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

export const claudeService = {
  async generateReply(customerMessage: string, knowledgeContext: string, conversationHistory: string, companyId?: string | null) {
    const config = await companyIntegrationService.aiModel(companyId);
    const text = await generateWithAiModel({
      config,
      companyId,
      purpose: "generate_reply",
      maxTokens: 300,
      temperature: 0.3,
      system: SYSTEM_PROMPT,
      user: `Customer message:\n${customerMessage}\n\nRelevant company knowledge:\n${knowledgeContext || "No matching knowledge base content found."}\n\nRecent conversation:\n${conversationHistory || "No prior conversation."}\n\nGenerate the next WhatsApp reply. Keep it under 700 characters. Do not use markdown tables. Ask one follow-up question if useful.`
    });

    if (!text) {
      throw new Error("AI API returned an empty reply");
    }

    return compactReply(text);
  },

  async extractOrderSummary(conversationHistory: string, currentSummary: ExtractedOrderSummary = {}, companyId?: string | null) {
    let config: AiModelCredentials;
    try {
      config = await companyIntegrationService.aiModel(companyId);
    } catch {
      if (!localIntegrationFallbackEnabled() || !env.ANTHROPIC_API_KEY) return null;
      config = {
        provider: "ANTHROPIC",
        modelName: env.CLAUDE_MODEL,
        apiKey: env.ANTHROPIC_API_KEY,
        baseUrl: null
      };
    }

    const text = await generateWithAiModel({
      config,
      companyId,
      purpose: "extract_order_summary",
      maxTokens: 450,
      temperature: 0,
      system:
        "Extract order details from WhatsApp conversations. Return only valid JSON. Do not add markdown, comments, or prose. Preserve known fields unless newer customer messages clearly replace them.",
      user: `Current order summary JSON:\n${JSON.stringify(currentSummary)}\n\nConversation history:\n${conversationHistory || "No conversation."}\n\nReturn exactly this JSON shape with null for unknown values:\n{\n  "productType": string | null,\n  "quantity": number | null,\n  "size": string | null,\n  "color": string | null,\n  "gsm": string | null,\n  "customization": string | null,\n  "deliveryLocation": string | null,\n  "notes": string | null,\n  "confidenceScore": number\n}\n\nRules:\n- Extract product type such as T-Shirts, Hoodies, Polo, Kids Wear, Oversized T-Shirts.\n- Extract quantity only as a number.\n- Extract size, color, GSM, printing/customization, and delivery location if stated.\n- confidenceScore must be 0 to 1 based on confidence in extracted fields.\n- Do not infer prices or business policies.`
    });

    return parseJsonObject(text);
  }
};
