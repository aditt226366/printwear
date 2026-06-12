import { MessageDirection, OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { chatEventsService } from "./chatEvents.service.js";
import { claudeService, type ExtractedOrderSummary } from "./claude.service.js";
import { logger } from "../utils/logger.js";

const manualStatuses = new Set<OrderStatus>([
  OrderStatus.CONFIRMED,
  OrderStatus.READY_FOR_DISPATCH,
  OrderStatus.DISPATCHED,
  OrderStatus.CANCELLED
]);

const productPatterns: Array<[RegExp, string]> = [
  [/\bhoodies?\b/i, "Hoodies"],
  [/\bpolo\b|\bcollar\b/i, "Polo/Collar T-Shirts"],
  [/\boversized\b/i, "Oversized T-Shirts"],
  [/\bt[\s-]?shirts?\b|\bround neck\b/i, "T-Shirts"],
  [/\bkids?\b/i, "Kids Wear"]
];

const colors = ["black", "white", "blue", "navy", "red", "green", "grey", "gray", "yellow", "orange", "pink", "purple", "maroon", "beige"];
const sizePattern = /\b(xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl)\b/i;
const gsmPattern = /\b(\d{2,3})\s*gsm\b/i;
const locationPattern = /\b(?:deliver(?:y)? to|ship to|send to|location is|in)\s+([a-z][a-z\s,-]{2,40})/i;
const customizationPattern = /\b(logo print(?:ing)?|screen print(?:ing)?|dtf print(?:ing)?|embroidery|custom print(?:ing)?|print(?:ing)?|with my logo|logo)\b/i;
const quotePattern = /\b(price|pricing|rate|cost|quote|quotation|estimate)\b/i;

type OrderPatch = {
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

function clean(value?: string | null) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function title(value: string) {
  return value.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function clampConfidence(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeQuantity(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return null;
  return Math.round(value);
}

function mergeValue<T>(next: T | null | undefined, current: T | null | undefined) {
  return next !== undefined && next !== null && String(next).trim() !== "" ? next : current ?? null;
}

function parseOrderFromText(text: string): ExtractedOrderSummary {
  const quantityMatch = text.match(/\b(\d{1,6})\s*(?:pcs?|pieces?|qty|quantity|units?)?\b/i);
  const sizeMatch = text.match(sizePattern);
  const gsmMatch = text.match(gsmPattern);
  const locationMatch = text.match(locationPattern);
  const customizationMatch = text.match(customizationPattern);
  const color = colors.find((candidate) => new RegExp(`\\b${candidate}\\b`, "i").test(text));
  const product = productPatterns.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  const extractedCount = [product, quantityMatch?.[1], sizeMatch?.[1], color, gsmMatch?.[1], locationMatch?.[1], customizationMatch?.[1]].filter(Boolean).length;

  return {
    productType: product,
    quantity: quantityMatch ? Number(quantityMatch[1]) : null,
    size: sizeMatch?.[1]?.toUpperCase() ?? null,
    color: color ? title(color) : null,
    gsm: gsmMatch ? `${gsmMatch[1]} GSM` : null,
    customization: customizationMatch ? title(customizationMatch[1].replace(/\bmy\b/i, "").trim()) : null,
    deliveryLocation: locationMatch ? title(locationMatch[1].replace(/[,.].*$/, "").trim()) : null,
    notes: null,
    confidenceScore: Math.min(0.92, 0.24 + extractedCount * 0.1)
  };
}

function mergeSummary(current: OrderPatch | null, extracted: OrderPatch): Required<OrderPatch> {
  return {
    productType: clean(mergeValue(extracted.productType, current?.productType)),
    quantity: normalizeQuantity(mergeValue(extracted.quantity, current?.quantity)),
    size: clean(mergeValue(extracted.size, current?.size)),
    color: clean(mergeValue(extracted.color, current?.color)),
    gsm: clean(mergeValue(extracted.gsm, current?.gsm)),
    customization: clean(mergeValue(extracted.customization, current?.customization)),
    deliveryLocation: clean(mergeValue(extracted.deliveryLocation, current?.deliveryLocation)),
    notes: clean(mergeValue(extracted.notes, current?.notes)),
    confidenceScore: Math.max(clampConfidence(current?.confidenceScore), clampConfidence(extracted.confidenceScore))
  };
}

function deriveStatus(summary: OrderPatch, conversationText: string, currentStatus?: OrderStatus | null) {
  if (currentStatus && manualStatuses.has(currentStatus)) return currentStatus;
  if (quotePattern.test(conversationText) && summary.productType && summary.quantity) return OrderStatus.QUOTATION_NEEDED;
  if (summary.productType && summary.quantity && (summary.size || summary.color || summary.customization || summary.deliveryLocation)) {
    return OrderStatus.READY_FOR_REVIEW;
  }
  return OrderStatus.COLLECTING_DETAILS;
}

function toPrismaData(summary: Required<OrderPatch>, status: OrderStatus): Prisma.OrderSummaryUncheckedCreateInput {
  return {
    leadId: "",
    productType: summary.productType,
    quantity: summary.quantity,
    size: summary.size,
    color: summary.color,
    gsm: summary.gsm,
    customization: summary.customization,
    deliveryLocation: summary.deliveryLocation,
    notes: summary.notes,
    confidenceScore: summary.confidenceScore ?? 0,
    status
  };
}

function formatOrder(order: Prisma.OrderSummaryGetPayload<{ include: { lead: { include: { messages: true } } } }>) {
  const lastMessage = order.lead.messages[0];
  return {
    id: order.id,
    leadId: order.leadId,
    customerName: order.lead.name,
    phone: order.lead.phone,
    productType: order.productType,
    quantity: order.quantity,
    size: order.size,
    color: order.color,
    gsm: order.gsm,
    customization: order.customization,
    deliveryLocation: order.deliveryLocation,
    notes: order.notes,
    status: order.status,
    confidenceScore: order.confidenceScore,
    updatedAt: order.updatedAt,
    lastMessage: lastMessage?.content ?? "No messages yet"
  };
}

export const orderSummaryService = {
  parseOrderFromText,
  deriveStatus,

  async refreshFromConversation(leadId: string) {
    const [lead, existing] = await Promise.all([
      prisma.lead.findUnique({
        where: { id: leadId },
        select: { id: true, name: true, phone: true }
      }),
      prisma.orderSummary.findUnique({ where: { leadId } })
    ]);

    if (!lead) return null;

    const messages = await prisma.message.findMany({
      where: { leadId, direction: MessageDirection.INBOUND },
      orderBy: { createdAt: "asc" },
      select: { content: true }
    });

    const conversationText = messages.map((message) => message.content).join("\n");
    if (!conversationText.trim()) return existing;

    const parserExtraction = parseOrderFromText(conversationText);
    let claudeExtraction: ExtractedOrderSummary | null = null;

    try {
      claudeExtraction = await claudeService.extractOrderSummary(conversationText, existing ?? {});
    } catch (error) {
      logger.warn({ error, leadId }, "Claude order extraction failed; using structured parser fallback");
    }

    const mergedParser = mergeSummary(existing, parserExtraction);
    const merged = mergeSummary(mergedParser, claudeExtraction ?? {});
    const status = deriveStatus(merged, conversationText, existing?.status);
    const data = toPrismaData(merged, status);
    data.leadId = leadId;

    return prisma.orderSummary.upsert({
      where: { leadId },
      create: data,
      update: {
        productType: data.productType,
        quantity: data.quantity,
        size: data.size,
        color: data.color,
        gsm: data.gsm,
        customization: data.customization,
        deliveryLocation: data.deliveryLocation,
        notes: data.notes,
        confidenceScore: data.confidenceScore,
        status: data.status
      }
    });
  },

  async listPipeline() {
    const orders = await prisma.orderSummary.findMany({
      where: { status: { not: OrderStatus.CANCELLED } },
      orderBy: { updatedAt: "desc" },
      include: {
        lead: {
          include: {
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1
            }
          }
        }
      }
    });

    const grouped = Object.fromEntries(
      Object.values(OrderStatus).map((status) => [status, [] as ReturnType<typeof formatOrder>[]])
    ) as Record<OrderStatus, ReturnType<typeof formatOrder>[]>;

    for (const order of orders) {
      grouped[order.status].push(formatOrder(order));
    }

    return grouped;
  },

  async updateStatus(orderId: string, status: OrderStatus) {
    const order = await prisma.orderSummary.update({
      where: { id: orderId },
      data: { status }
    });

    chatEventsService.publish({
      type: "order.updated",
      leadId: order.leadId,
      payload: { order }
    });

    return order;
  },

  async updateOrder(orderId: string, input: OrderPatch) {
    const data: Prisma.OrderSummaryUpdateInput = {};
    if ("productType" in input) data.productType = clean(input.productType);
    if ("quantity" in input) data.quantity = normalizeQuantity(input.quantity);
    if ("size" in input) data.size = clean(input.size);
    if ("color" in input) data.color = clean(input.color);
    if ("gsm" in input) data.gsm = clean(input.gsm);
    if ("customization" in input) data.customization = clean(input.customization);
    if ("deliveryLocation" in input) data.deliveryLocation = clean(input.deliveryLocation);
    if ("notes" in input) data.notes = clean(input.notes);
    if ("confidenceScore" in input) data.confidenceScore = clampConfidence(input.confidenceScore);

    const order = await prisma.orderSummary.update({
      where: { id: orderId },
      data
    });

    chatEventsService.publish({
      type: "order.updated",
      leadId: order.leadId,
      payload: { order }
    });

    return order;
  }
};
