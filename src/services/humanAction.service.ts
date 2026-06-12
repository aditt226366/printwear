import { HumanPriority, LeadTemperature } from "@prisma/client";
import { prisma } from "../config/prisma.js";

type HumanAttention = {
  priority: HumanPriority;
  reason: string;
};

const highRules: Array<{ priority: HumanPriority; reason: string; patterns: RegExp[] }> = [
  {
    priority: HumanPriority.HIGH,
    reason: "Quotation requested",
    patterns: [/\bquote\b/i, /\bquotation\b/i, /\bestimate\b/i]
  },
  {
    priority: HumanPriority.HIGH,
    reason: "Payment question",
    patterns: [/\bpayment\b/i, /\bpay\b/i, /\badvance\b/i, /\binvoice\b/i]
  },
  {
    priority: HumanPriority.HIGH,
    reason: "Order confirmation needed",
    patterns: [/\bconfirm\b/i, /\bconfirmed\b/i, /\bplace (an )?order\b/i, /\bfinal\b/i]
  },
  {
    priority: HumanPriority.HIGH,
    reason: "Human takeover requested",
    patterns: [/\bhuman\b/i, /\bagent\b/i, /\bperson\b/i, /\bteam\b/i, /\bcall me\b/i, /\btalk to\b/i]
  },
  {
    priority: HumanPriority.HIGH,
    reason: "Negative customer sentiment",
    patterns: [/\bangry\b/i, /\bupset\b/i, /\bbad\b/i, /\bnot happy\b/i, /\bcomplaint\b/i, /\bwrong\b/i, /\bterrible\b/i]
  }
];

const mediumRules: Array<{ priority: HumanPriority; reason: string; patterns: RegExp[] }> = [
  {
    priority: HumanPriority.MEDIUM,
    reason: "Pricing or product details requested",
    patterns: [/\bprice\b/i, /\bpricing\b/i, /\brate\b/i, /\bcost\b/i, /\bdetails\b/i, /\bcatalog(?:ue)?\b/i]
  },
  {
    priority: HumanPriority.MEDIUM,
    reason: "Sample requested",
    patterns: [/\bsample\b/i]
  },
  {
    priority: HumanPriority.MEDIUM,
    reason: "Delivery or customization question",
    patterns: [/\bdelivery\b/i, /\bdeliver\b/i, /\bcustom(?:ize|ise|ization|isation)?\b/i, /\bprint(?:ing)?\b/i, /\blogo\b/i]
  },
  {
    priority: HumanPriority.MEDIUM,
    reason: "Customer seems confused",
    patterns: [/\bconfused\b/i, /\bdon'?t understand\b/i, /\bnot clear\b/i, /\bwhat do you mean\b/i]
  }
];

const lowRules: Array<{ priority: HumanPriority; reason: string; patterns: RegExp[] }> = [
  {
    priority: HumanPriority.LOW,
    reason: "General enquiry",
    patterns: [/\bhello\b/i, /\bhi\b/i, /\binterested\b/i, /\benquiry\b/i, /\binquiry\b/i]
  },
  {
    priority: HumanPriority.LOW,
    reason: "Follow-up needed",
    patterns: [/\bfollow up\b/i, /\bupdate\b/i, /\bwaiting\b/i]
  }
];

function temperatureFromMessageCount(messageCount: number) {
  if (messageCount >= 6) return LeadTemperature.HOT;
  if (messageCount >= 2) return LeadTemperature.WARM;
  return LeadTemperature.SCRAP;
}

function preview(value?: string | null) {
  return String(value || "No messages yet").replace(/\s+/g, " ").trim();
}

function detectHumanAttention(message: string): HumanAttention | null {
  const rules = [...highRules, ...mediumRules, ...lowRules];
  return rules.find((rule) => rule.patterns.some((pattern) => pattern.test(message))) ?? null;
}

function formatQueueItem(lead: {
  id: string;
  name: string;
  phone: string;
  messageCount: number;
  humanPriority: HumanPriority | null;
  humanReason: string | null;
  updatedAt: Date;
  messages: Array<{ content: string; createdAt: Date }>;
}) {
  const lastMessage = lead.messages[0];

  return {
    id: lead.id,
    leadId: lead.id,
    customerName: lead.name,
    phone: lead.phone,
    priority: lead.humanPriority,
    reason: lead.humanReason,
    lastMessage: preview(lastMessage?.content),
    time: lastMessage?.createdAt ?? lead.updatedAt,
    temperature: temperatureFromMessageCount(lead.messageCount),
    messageCount: lead.messageCount
  };
}

function priorityRank(priority: HumanPriority | null) {
  if (priority === HumanPriority.HIGH) return 0;
  if (priority === HumanPriority.MEDIUM) return 1;
  return 2;
}

export const humanActionService = {
  detectHumanAttention,

  async analyzeInboundMessage(leadId: string, content: string) {
    const attention = detectHumanAttention(content);
    if (!attention) return null;

    return prisma.lead.update({
      where: { id: leadId },
      data: {
        humanTakeoverRequired: true,
        humanPriority: attention.priority,
        humanReason: attention.reason,
        humanResolvedAt: null
      }
    });
  },

  async listQueue() {
    const leads = await prisma.lead.findMany({
      where: {
        humanTakeoverRequired: true,
        humanResolvedAt: null
      },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    return leads
      .map(formatQueueItem)
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || new Date(b.time).getTime() - new Date(a.time).getTime());
  },

  async resolve(leadId: string) {
    return prisma.lead.update({
      where: { id: leadId },
      data: {
        humanTakeoverRequired: false,
        humanResolvedAt: new Date()
      }
    });
  }
};
