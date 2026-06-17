import {
  AutomationSendStatus,
  HumanPriority,
  MessageDirection,
  OrderStatus,
  WorkflowRunStatus
} from "@prisma/client";
import { prisma } from "../config/prisma.js";

type PulseSegmentKey =
  | "all_attention"
  | "inbox"
  | "orders"
  | "ai_handoffs"
  | "human_queue"
  | "campaign_replies";

type PrioritySeverity = "critical" | "warning" | "live" | "quiet";

type PriorityItem = {
  id: string;
  type: string;
  segmentKey: PulseSegmentKey;
  severity: PrioritySeverity;
  title: string;
  summary: string;
  module: string;
  sourceObjectType: string;
  sourceObjectId: string;
  leadId?: string | null;
  orderId?: string | null;
  workflowId?: string | null;
  campaignId?: string | null;
  recommendedAction: string;
  createdAt: Date;
  updatedAt: Date;
};

type ContextLink = {
  label: string;
  module: string;
  targetView: "chats" | "orders" | "campaigns" | "broadcasts" | "flows" | "human" | "contacts";
  objectType: string;
  objectId: string;
};

type ContextAction = {
  label: string;
  targetLabel: "Inbox" | "Orders" | "Campaigns" | "Broadcasts" | "AI Flows" | "Human Queue";
  targetView: ContextLink["targetView"];
  objectType: string;
  objectId: string;
};

type InterpreterContext = {
  priorityItemId: string | null;
  pulseSegment: PulseSegmentKey;
  title: string;
  source: string;
  whatHappened: string;
  whyItMatters: string;
  recommendedAction: ContextAction | null;
  linkedWork: ContextLink[];
  resolutionTrail: string[];
};

const segmentOrder: Array<{ key: PulseSegmentKey; label: string; module: string }> = [
  { key: "all_attention", label: "All Attention", module: "Command" },
  { key: "inbox", label: "Inbox", module: "Inbox" },
  { key: "orders", label: "Orders", module: "Orders" },
  { key: "ai_handoffs", label: "AI Handoffs", module: "AI Flows" },
  { key: "human_queue", label: "Human Queue", module: "Human Queue" },
  { key: "campaign_replies", label: "Campaigns / Broadcasts", module: "Campaigns / Broadcasts" }
];

const severityRank: Record<PrioritySeverity, number> = {
  critical: 0,
  warning: 1,
  live: 2,
  quiet: 3
};

const attentionOrderStatuses = new Set<OrderStatus>([
  OrderStatus.COLLECTING_DETAILS,
  OrderStatus.READY_FOR_REVIEW,
  OrderStatus.QUOTATION_NEEDED
]);

function asSegmentKey(value: unknown): PulseSegmentKey {
  const key = String(value || "all_attention");
  return segmentOrder.some((segment) => segment.key === key) ? (key as PulseSegmentKey) : "all_attention";
}

function priorityForHuman(value: HumanPriority | null): PrioritySeverity {
  if (value === HumanPriority.HIGH) return "critical";
  if (value === HumanPriority.MEDIUM) return "warning";
  return "live";
}

function orderSeverity(status: OrderStatus): PrioritySeverity {
  if (status === OrderStatus.QUOTATION_NEEDED) return "critical";
  if (status === OrderStatus.READY_FOR_REVIEW) return "warning";
  if (status === OrderStatus.COLLECTING_DETAILS) return "live";
  return "quiet";
}

function severityFromItems(items: PriorityItem[]): PrioritySeverity {
  if (!items.length) return "quiet";
  return items.reduce<PrioritySeverity>((highest, item) =>
    severityRank[item.severity] < severityRank[highest] ? item.severity : highest,
  "quiet");
}

function latestDate(items: Array<{ updatedAt?: Date | null; createdAt?: Date | null }>) {
  return items
    .flatMap((item) => [item.updatedAt, item.createdAt])
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
}

function preview(value?: string | null) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "No message preview available.";
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function customerName(value?: string | null) {
  return String(value || "Customer").trim() || "Customer";
}

function sortPriorityItems(items: PriorityItem[]) {
  return [...items].sort((a, b) => {
    const severityDelta = severityRank[a.severity] - severityRank[b.severity];
    if (severityDelta) return severityDelta;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function uniqueById(items: PriorityItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function minutesSince(value: Date) {
  return Math.max(1, Math.round((Date.now() - value.getTime()) / 60000));
}

function operationalStatement(input: {
  count: number;
  empty: string;
  singular: string;
  plural: string;
}) {
  if (input.count <= 0) return input.empty;
  return input.count === 1 ? input.singular : input.plural.replace("{count}", String(input.count));
}

function actionTarget(item: PriorityItem): ContextAction {
  if (item.orderId) {
    return {
      label: item.recommendedAction,
      targetLabel: "Orders",
      targetView: "orders",
      objectType: "OrderSummary",
      objectId: item.orderId
    };
  }

  if (item.workflowId) {
    return {
      label: item.recommendedAction,
      targetLabel: "AI Flows",
      targetView: "flows",
      objectType: "AiWorkflow",
      objectId: item.workflowId
    };
  }

  if (item.module === "Broadcasts") {
    return {
      label: item.recommendedAction,
      targetLabel: "Broadcasts",
      targetView: "broadcasts",
      objectType: item.sourceObjectType,
      objectId: item.sourceObjectId
    };
  }

  if (item.campaignId || item.segmentKey === "campaign_replies") {
    return {
      label: item.recommendedAction,
      targetLabel: "Campaigns",
      targetView: "campaigns",
      objectType: item.campaignId ? "Campaign" : item.sourceObjectType,
      objectId: item.campaignId ?? item.sourceObjectId
    };
  }

  if (item.segmentKey === "human_queue") {
    return {
      label: item.recommendedAction,
      targetLabel: "Human Queue",
      targetView: "human",
      objectType: item.sourceObjectType,
      objectId: item.sourceObjectId
    };
  }

  return {
    label: item.recommendedAction,
    targetLabel: "Inbox",
    targetView: "chats",
    objectType: item.sourceObjectType,
    objectId: item.sourceObjectId
  };
}

function linkedWork(item: PriorityItem): ContextLink[] {
  const links: ContextLink[] = [];
  const action = actionTarget(item);
  links.push({
    label: action.targetLabel,
    module: action.targetLabel,
    targetView: action.targetView,
    objectType: action.objectType,
    objectId: action.objectId
  });

  if (item.leadId && action.targetLabel !== "Inbox") {
    links.push({
      label: "Inbox thread",
      module: "Inbox",
      targetView: "chats",
      objectType: "Lead",
      objectId: item.leadId
    });
  }

  if (item.orderId && action.targetLabel !== "Orders") {
    links.push({
      label: "Order summary",
      module: "Orders",
      targetView: "orders",
      objectType: "OrderSummary",
      objectId: item.orderId
    });
  }

  if (item.workflowId && action.targetLabel !== "AI Flows") {
    links.push({
      label: "Workflow",
      module: "AI Flows",
      targetView: "flows",
      objectType: "AiWorkflow",
      objectId: item.workflowId
    });
  }

  if (item.campaignId && action.targetLabel !== "Campaigns") {
    links.push({
      label: "Campaign",
      module: "Campaigns",
      targetView: "campaigns",
      objectType: "Campaign",
      objectId: item.campaignId
    });
  }

  return links;
}

function whatHappened(item: PriorityItem) {
  if (item.type === "human_takeover") return `Human takeover is waiting: ${item.summary}`;
  if (item.type === "workflow_failure") return `An AI flow failed during execution: ${item.summary}`;
  if (item.type === "order_attention") return `An order conversation entered an attention state: ${item.summary}`;
  if (item.type === "campaign_reply") return `A campaign recipient replied after send: ${item.summary}`;
  if (item.type === "campaign_delivery_failed") return `A campaign delivery failed: ${item.summary}`;
  if (item.type === "broadcast_delivery_failed") return `A broadcast delivery failed: ${item.summary}`;
  return `A customer conversation produced a new inbound signal: ${item.summary}`;
}

function whyItMatters(item: PriorityItem) {
  if (item.severity === "critical") {
    return `${item.module} is carrying a critical signal, so it should be handled before lower-intensity work.`;
  }
  if (item.segmentKey === "orders") {
    return "Order progress depends on a clear operator decision before the customer can move forward.";
  }
  if (item.segmentKey === "ai_handoffs") {
    return "Automation cannot safely continue until a human reviews the failed workflow path.";
  }
  if (item.segmentKey === "campaign_replies") {
    return "Post-send movement is time-sensitive because campaign replies decay quickly without follow-up.";
  }
  if (item.segmentKey === "human_queue") {
    return "The system has already escalated this conversation beyond normal automated handling.";
  }
  return "A recent inbound reply is active enough to affect response velocity and customer momentum.";
}

function resolutionTrail(item: PriorityItem) {
  const created = minutesSince(item.createdAt);
  const updated = minutesSince(item.updatedAt);
  const trail = [
    `${item.module} signal created ${created} min ago.`,
    `Latest related activity ${updated} min ago.`
  ];

  if (item.segmentKey === "human_queue") trail.push("Queued for human ownership.");
  if (item.segmentKey === "ai_handoffs") trail.push("Automation paused until the failed run is reviewed.");
  if (item.segmentKey === "orders") trail.push("Order remains open until the next operator action is recorded.");
  if (item.segmentKey === "campaign_replies") trail.push("Campaign follow-up remains unresolved.");
  if (item.segmentKey === "inbox") trail.push("Inbox response remains pending.");

  return trail;
}

function buildItemContext(item: PriorityItem): InterpreterContext {
  return {
    priorityItemId: item.id,
    pulseSegment: item.segmentKey,
    title: item.title,
    source: item.module,
    whatHappened: whatHappened(item),
    whyItMatters: whyItMatters(item),
    recommendedAction: actionTarget(item),
    linkedWork: linkedWork(item),
    resolutionTrail: resolutionTrail(item)
  };
}

function buildSegmentContext(activeSegment: PulseSegmentKey, items: PriorityItem[]): InterpreterContext {
  const segment = segmentOrder.find((entry) => entry.key === activeSegment) ?? segmentOrder[0];
  const highestSeverity = severityFromItems(items);
  const latest = latestDate(items);
  return {
    priorityItemId: null,
    pulseSegment: activeSegment,
    title: `${segment.label} lens`,
    source: segment.module,
    whatHappened: items.length
      ? `${segment.label} contains ${items.length} active attention signal${items.length === 1 ? "" : "s"}.`
      : `${segment.label} has no active attention signals.`,
    whyItMatters: items.length
      ? `The highest current signal is ${highestSeverity}, with latest movement${latest ? ` ${minutesSince(latest)} min ago` : " recently"}.`
      : "This lens is clear, so attention can stay on the broader queue.",
    recommendedAction: items[0] ? actionTarget(items[0]) : null,
    linkedWork: items[0] ? linkedWork(items[0]) : [],
    resolutionTrail: items.length
      ? [
          `${items.length} item${items.length === 1 ? "" : "s"} in this pulse segment.`,
          `Highest severity: ${highestSeverity}.`,
          latest ? `Latest related activity ${minutesSince(latest)} min ago.` : "No timestamped activity available."
        ]
      : ["No unresolved work in this pulse segment."]
  };
}

export const commandCenterService = {
  async snapshot(companyId?: string, selectedSegment?: unknown) {
    const activeSegment = asSegmentKey(selectedSegment);
    const leadWhere = companyId ? { companyId } : {};
    const relationCompanyWhere = companyId ? { lead: { companyId } } : {};

    const [
      recentLeads,
      humanQueueLeads,
      orderSummaries,
      workflowLogs,
      campaignRecipients,
      bulkMessageRecipients
    ] = await Promise.all([
      prisma.lead.findMany({
        where: leadWhere,
        orderBy: { updatedAt: "desc" },
        take: 80,
        include: {
          orderSummary: true,
          messages: {
            orderBy: { createdAt: "desc" },
            take: 2
          }
        }
      }),
      prisma.lead.findMany({
        where: {
          ...leadWhere,
          humanTakeoverRequired: true,
          humanResolvedAt: null
        },
        orderBy: [{ humanPriority: "asc" }, { updatedAt: "desc" }],
        take: 50,
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1
          }
        }
      }),
      prisma.orderSummary.findMany({
        where: {
          ...(companyId ? { lead: { companyId } } : {}),
          status: { not: OrderStatus.CANCELLED }
        },
        orderBy: { updatedAt: "desc" },
        take: 80,
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
      }),
      prisma.workflowExecutionLog.findMany({
        where: companyId ? { workflow: { companyId } } : {},
        orderBy: { createdAt: "desc" },
        take: 80,
        include: {
          workflow: true,
          lead: true
        }
      }),
      prisma.campaignRecipient.findMany({
        where: companyId ? { campaign: { companyId } } : {},
        orderBy: { updatedAt: "desc" },
        take: 80,
        include: {
          campaign: true,
          lead: {
            include: {
              messages: {
                orderBy: { createdAt: "desc" },
                take: 3
              }
            }
          }
        }
      }),
      prisma.bulkMessageRecipient.findMany({
        where: companyId ? { bulkMessageJob: { companyId } } : {},
        orderBy: { updatedAt: "desc" },
        take: 80,
        include: {
          bulkMessageJob: true,
          lead: true
        }
      })
    ]);

    const inboxItems: PriorityItem[] = recentLeads
      .filter((lead) => lead.messages[0]?.direction === MessageDirection.INBOUND)
      .map((lead) => {
        const lastMessage = lead.messages[0];
        const severity: PrioritySeverity = lead.humanTakeoverRequired ? priorityForHuman(lead.humanPriority) : "live";
        return {
          id: `inbox:${lead.id}`,
          type: "conversation_reply",
          segmentKey: "inbox",
          severity,
          title: `${customerName(lead.name)} replied`,
          summary: preview(lastMessage?.content),
          module: "Inbox",
          sourceObjectType: "Lead",
          sourceObjectId: lead.id,
          leadId: lead.id,
          recommendedAction: "Open conversation",
          createdAt: lastMessage?.createdAt ?? lead.createdAt,
          updatedAt: lastMessage?.createdAt ?? lead.updatedAt
        };
      });

    const humanQueueItems: PriorityItem[] = humanQueueLeads.map((lead) => {
      const lastMessage = lead.messages[0];
      return {
        id: `human:${lead.id}`,
        type: "human_takeover",
        segmentKey: "human_queue",
        severity: priorityForHuman(lead.humanPriority),
        title: lead.humanReason || "Human takeover requested",
        summary: `${customerName(lead.name)} - ${preview(lastMessage?.content)}`,
        module: "Human Queue",
        sourceObjectType: "Lead",
        sourceObjectId: lead.id,
        leadId: lead.id,
        recommendedAction: "Take over conversation",
        createdAt: lead.createdAt,
        updatedAt: lastMessage?.createdAt ?? lead.updatedAt
      };
    });

    const orderItems: PriorityItem[] = orderSummaries
      .filter((order) => attentionOrderStatuses.has(order.status))
      .map((order) => {
        const lastMessage = order.lead.messages[0];
        return {
          id: `order:${order.id}`,
          type: "order_attention",
          segmentKey: "orders",
          severity: orderSeverity(order.status),
          title: `${customerName(order.lead.name)} order is ${String(order.status).toLowerCase().replace(/_/g, " ")}`,
          summary: order.productType
            ? `${order.productType}${order.quantity ? ` - ${order.quantity} pcs` : ""}`
            : preview(lastMessage?.content),
          module: "Orders",
          sourceObjectType: "OrderSummary",
          sourceObjectId: order.id,
          leadId: order.leadId,
          orderId: order.id,
          recommendedAction: order.status === OrderStatus.QUOTATION_NEEDED ? "Prepare quotation" : "Review order",
          createdAt: order.createdAt,
          updatedAt: order.updatedAt
        };
      });

    const aiItems: PriorityItem[] = workflowLogs
      .filter((log) => log.status === WorkflowRunStatus.FAILED)
      .map((log) => ({
        id: `workflow:${log.id}`,
        type: "workflow_failure",
        segmentKey: "ai_handoffs",
        severity: "critical",
        title: `${log.workflow.name} needs review`,
        summary: log.errorMessage || `Workflow failed${log.lead ? ` for ${customerName(log.lead.name)}` : ""}.`,
        module: "AI Flows",
        sourceObjectType: "WorkflowExecutionLog",
        sourceObjectId: log.id,
        leadId: log.leadId,
        workflowId: log.workflowId,
        recommendedAction: "Review AI flow",
        createdAt: log.createdAt,
        updatedAt: log.createdAt
      }));

    const campaignItems: PriorityItem[] = campaignRecipients.flatMap((recipient) => {
      const inboundAfterSend = recipient.lead.messages.find((message) =>
        message.direction === MessageDirection.INBOUND && recipient.sentAt && message.createdAt >= recipient.sentAt
      );
      const items: PriorityItem[] = [];

      if (inboundAfterSend) {
        items.push({
          id: `campaign-reply:${recipient.id}:${inboundAfterSend.id}`,
          type: "campaign_reply",
          segmentKey: "campaign_replies",
          severity: "live",
          title: `${customerName(recipient.lead.name)} replied to ${recipient.campaign.name}`,
          summary: preview(inboundAfterSend.content),
          module: "Campaigns",
          sourceObjectType: "CampaignRecipient",
          sourceObjectId: recipient.id,
          leadId: recipient.leadId,
          campaignId: recipient.campaignId,
          recommendedAction: "Open reply",
          createdAt: inboundAfterSend.createdAt,
          updatedAt: inboundAfterSend.createdAt
        });
      }

      if (recipient.status === AutomationSendStatus.FAILED) {
        items.push({
          id: `campaign-failed:${recipient.id}`,
          type: "campaign_delivery_failed",
          segmentKey: "campaign_replies",
          severity: "warning",
          title: `${recipient.campaign.name} has a failed recipient`,
          summary: recipient.errorMessage || `${customerName(recipient.lead.name)} did not receive the campaign message.`,
          module: "Campaigns",
          sourceObjectType: "CampaignRecipient",
          sourceObjectId: recipient.id,
          leadId: recipient.leadId,
          campaignId: recipient.campaignId,
          recommendedAction: "Review campaign delivery",
          createdAt: recipient.createdAt,
          updatedAt: recipient.updatedAt
        });
      }

      return items;
    });

    const bulkItems: PriorityItem[] = bulkMessageRecipients
      .filter((recipient) => recipient.status === AutomationSendStatus.FAILED)
      .map((recipient) => ({
        id: `bulk-failed:${recipient.id}`,
        type: "broadcast_delivery_failed",
        segmentKey: "campaign_replies",
        severity: "warning",
        title: `${recipient.bulkMessageJob.name} has a failed broadcast recipient`,
        summary: recipient.errorMessage || `${customerName(recipient.lead.name)} did not receive the broadcast message.`,
        module: "Broadcasts",
        sourceObjectType: "BulkMessageRecipient",
        sourceObjectId: recipient.id,
        leadId: recipient.leadId,
        recommendedAction: "Review broadcast delivery",
        createdAt: recipient.createdAt,
        updatedAt: recipient.updatedAt
      }));

    const allPriorityItems = sortPriorityItems(uniqueById([
      ...humanQueueItems,
      ...aiItems,
      ...orderItems,
      ...campaignItems,
      ...bulkItems,
      ...inboxItems
    ]));
    const filteredItems = activeSegment === "all_attention"
      ? allPriorityItems
      : allPriorityItems.filter((item) => item.segmentKey === activeSegment);
    const itemsBySegment = new Map<PulseSegmentKey, PriorityItem[]>();
    for (const segment of segmentOrder) {
      itemsBySegment.set(segment.key, segment.key === "all_attention" ? allPriorityItems : allPriorityItems.filter((item) => item.segmentKey === segment.key));
    }
    const maxSegmentCount = Math.max(1, ...segmentOrder.map((segment) => itemsBySegment.get(segment.key)?.length ?? 0));

    const pulseSegments = segmentOrder.map((segment) => {
      const items = itemsBySegment.get(segment.key) ?? [];
      const lastActivityAt = latestDate(items);
      return {
        key: segment.key,
        label: segment.label,
        module: segment.module,
        count: items.length,
        severity: severityFromItems(items),
        intensity: Math.round((items.length / maxSegmentCount) * 100),
        active: segment.key === activeSegment,
        lastActivityAt,
        summary: items.length
          ? `${items.length} attention signal${items.length === 1 ? "" : "s"}${lastActivityAt ? `, latest ${minutesSince(lastActivityAt)} min ago` : ""}`
          : "No active attention signals"
      };
    });

    const aiFailureCount = aiItems.length;
    const openOrderCount = orderSummaries.filter((order) => order.status !== OrderStatus.CANCELLED).length;
    const activeConversationCount = recentLeads.filter((lead) => Number(lead.messageCount || 0) > 0).length;
    const secondarySignals = [
      {
        key: "active_conversations",
        statement: operationalStatement({
          count: activeConversationCount,
          empty: "Conversation movement is quiet across active threads.",
          singular: "One conversation is actively moving and may need attention.",
          plural: "{count} conversations are actively moving across the workspace."
        }),
        tone: activeConversationCount ? "live" : "quiet"
      },
      {
        key: "open_orders",
        statement: operationalStatement({
          count: openOrderCount,
          empty: "Order confirmations remain stable with no open order pressure.",
          singular: "One open order is still moving through conversation.",
          plural: "Order confirmations remain active across {count} open orders."
        }),
        tone: openOrderCount ? "live" : "quiet"
      },
      {
        key: "workflow_failures",
        statement: operationalStatement({
          count: aiFailureCount,
          empty: "AI-handled threads are not reporting workflow failures.",
          singular: "Reply velocity is blocked by one failed AI flow.",
          plural: "Reply velocity is blocked by {count} failed AI flow runs."
        }),
        tone: aiFailureCount ? "warning" : "quiet"
      }
    ];
    const selectedPriorityItemId = filteredItems[0]?.id ?? null;
    const visiblePriorityItems = filteredItems.slice(0, 12);
    const selectedPriorityItem = visiblePriorityItems[0] ?? null;
    const defaultContext = selectedPriorityItem
      ? buildItemContext(selectedPriorityItem)
      : buildSegmentContext(activeSegment, filteredItems);

    return {
      question: "What needs attention now?",
      selectedPulseSegment: activeSegment,
      pulse: {
        activeSegment,
        segments: pulseSegments
      },
      priorityQueue: {
        activeFilter: activeSegment,
        selectedPriorityItemId,
        totalCount: allPriorityItems.length,
        items: visiblePriorityItems
      },
      timeline: {
        events: []
      },
      context: {
        activeSegment,
        selectedPriorityItemId,
        default: defaultContext,
        items: visiblePriorityItems.map(buildItemContext)
      },
      secondarySignals,
      lastUpdatedAt: new Date()
    };
  }
};
