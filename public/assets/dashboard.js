const state = {
  leads: [],
  selectedLeadId: null,
  selectedConversation: null,
  session: null,
  features: [],
  integration: null,
  enabledFeatureKeys: new Set(),
  leadSearch: "",
  chatSearch: "",
  chatFilter: "all",
  chatTemperatureFilter: "",
  temperatureFilter: "",
  currentView: "overview",
  overviewLoaded: false,
  latestOverview: null,
  commandCenter: null,
  selectedPulseSegment: "all_attention",
  selectedPriorityItemId: null,
  isLoadingCommandCenter: false,
  commandCenterLastUpdatedAt: null,
  isRefreshing: false,
  humanActionQueue: [],
  orderPipeline: {},
  dashboardLoaded: false,
  isPolling: false,
  isSendingReply: false,
  connectionState: "connected",
  contacts: [],
  contactFacets: { tags: [], sources: [], statuses: [] },
  selectedContactIds: new Set(),
  contactFilters: { search: "", tag: "", status: "", source: "" },
  bulkJobs: [],
  campaigns: [],
  selectedCampaignId: null,
  adDrafts: [],
  metaAdsConnected: false,
  ads: {
    campaigns: [],
    metrics: {},
    connection: null,
    filter: "ALL",
    wizardStep: 1,
    editingId: null,
    adsManagerUrl: "https://business.facebook.com/adsmanager/manage/campaigns"
  },
  workflows: [],
  activeWorkflowId: null,
  workflowSearch: "",
  workflowDraft: {
    id: null,
    name: "",
    triggerType: "KEYWORD",
    triggerValue: "hi",
    isActive: false,
    zoom: 1,
    panX: 0,
    panY: 0,
    selectedNodeId: null,
    pendingConnectionId: null,
    definition: {
      nodes: [
        { id: "start-1", type: "start", label: "Flow Start", x: 650, y: 260, config: {} }
      ],
      edges: []
    }
  }
};

const DASHBOARD_POLL_INTERVAL_MS = 4000;
const REQUEST_TIMEOUT_MS = 12000;
const DASHBOARD_START_FALLBACK_MS = 14000;
const COMPANY_CONTEXT_MISSING_MESSAGE = "Company context missing. Please contact admin.";

const views = {
  overview: document.querySelector("#overviewView"),
  chats: document.querySelector("#chatsView"),
  leads: document.querySelector("#leadsView"),
  broadcasts: document.querySelector("#broadcastsView"),
  campaigns: document.querySelector("#campaignsView"),
  ads: document.querySelector("#adsView"),
  flows: document.querySelector("#flowsView"),
  orders: document.querySelector("#ordersView"),
  human: document.querySelector("#humanView"),
  reports: document.querySelector("#reportsView"),
  settings: document.querySelector("#settingsView")
};

const viewFeatureMap = {
  overview: "dashboard",
  chats: "chats",
  broadcasts: "broadcasts",
  campaigns: "campaigns",
  ads: "ads",
  flows: "ai_flows",
  human: "human_queue",
  orders: "orders",
  reports: "reports",
  settings: "settings"
};

const featureDescriptions = {
  dashboard: "Operating homepage with Conversation Pulse, Priority Queue, and Pulse Interpreter.",
  chats: "WhatsApp-style live inbox with AI replies, manual replies, takeover, tags, lead status, and message history.",
  contacts: "Audience workspace with CSV import, Google Sheets import, tags, source, lifecycle status, and segments.",
  broadcasts: "Bulk WhatsApp template messaging with audience selection, progress tracking, delivery/read status, and CRM history capture.",
  campaigns: "Scheduled and multi-step WhatsApp outreach with templates, run now, pause/cancel, delivery metrics, and reply tracking.",
  ads: "Facebook, Instagram, and WhatsApp click-to-chat ad planning with Meta status, drafts, previews, and tracking.",
  ai_flows: "Workflow automation builder with triggers, messages, conditions, delays, takeover, order draft blocks, tests, and logs.",
  human_queue: "Priority human takeover inbox with handoff reason, suggested reply, priority, owner, open chat, and return to AI.",
  orders: "WhatsApp-linked order operations with customer, product, quantity, size, color, delivery, status, and update sends.",
  reports: "Operational reporting for conversations, reply rate, campaigns, broadcasts, AI flows, and order movement.",
  settings: "Company and user settings only."
};

const premiumLibrariesReady = loadPremiumLibraries();

async function loadPremiumLibraries() {
  try {
    const [motionModule, lucideModule] = await Promise.all([
      import("https://esm.sh/motion@12.23.24"),
      import("https://esm.sh/lucide@0.468.0")
    ]);

    window.Motion = motionModule;
    window.lucide = {
      createIcons(options = {}) {
        lucideModule.createIcons({ icons: lucideModule.icons, ...options });
      }
    };
  } catch (error) {
    console.warn("Premium dashboard libraries could not be loaded.", error);
  }
}

function $(selector) {
  return document.querySelector(selector);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function pretty(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function relativeTime(value) {
  if (!value) return "Just now";
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.round(diff / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function durationLabel(minutes) {
  const safeMinutes = Math.max(0, Math.round(Number(minutes || 0)));
  if (safeMinutes < 60) return `${safeMinutes}m`;
  const hours = Math.round(safeMinutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function messageCountLabel(lead) {
  const count = Number(lead?.messageCount || 0);
  return `${count} msg${count === 1 ? "" : "s"}`;
}

function leadTemperature(lead) {
  const count = Number(lead?.messageCount || 0);
  if (count >= 6) return "HOT";
  if (count >= 2) return "WARM";
  return "SCRAP";
}

function previewText(value) {
  return String(value || "No messages yet").replace(/\s+/g, " ").trim();
}

function chatPreviewText(value) {
  const firstLine = String(value || "No messages yet").split(/\r?\n/)[0];
  return previewText(firstLine);
}

function unreadBadgeLabel(value) {
  const count = Number(value || 0);
  return count > 99 ? "99+" : String(count);
}

function messageTimestamp(message) {
  return message?.timestamp || message?.createdAt || message?.time || new Date().toISOString();
}

function hashString(value) {
  let hash = 0;
  const input = String(value || "");
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeMessage(message) {
  const direction = String(message?.direction || "INBOUND").toUpperCase();
  const text = message?.text ?? message?.content ?? "";
  const timestamp = messageTimestamp(message);

  return {
    id: String(message?.id || `msg-${hashString(`${direction}|${timestamp}|${text}`)}`),
    timestamp,
    createdAt: timestamp,
    direction,
    sender: message?.sender || (direction === "INBOUND" ? "Customer" : "Business"),
    text,
    content: text,
    status: message?.status || (direction === "INBOUND" ? "RECEIVED" : "SENT")
  };
}

function normalizeMessages(messages = []) {
  return [...messages]
    .map((message, index) => ({ ...normalizeMessage(message), index }))
    .sort((a, b) => {
      const timeDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.index - b.index;
    })
    .map(({ index, ...message }) => message);
}

function formatOrderStatus(value) {
  return pretty(String(value || "").replace(/_/g, " "));
}

function emptyValue(value) {
  return value === null || value === undefined || value === "" ? "--" : value;
}

function confidenceLabel(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function flattenOrders(pipeline = state.orderPipeline) {
  return Object.values(pipeline || {}).flatMap((orders) => (Array.isArray(orders) ? orders : []));
}

function orderStatusClass(value) {
  return String(value || "COLLECTING_DETAILS").toLowerCase().replace(/_/g, "-");
}

function normalizedOrderStatus(order) {
  return String(order?.status || "COLLECTING_DETAILS").toUpperCase();
}

function ordersDoneCount() {
  return flattenOrders().filter((order) =>
    ["CONFIRMED", "READY_FOR_DISPATCH", "DISPATCHED", "DELIVERED", "COMPLETED"].includes(normalizedOrderStatus(order))
  ).length;
}

function orderDeskStats() {
  const orders = flattenOrders();
  return {
    total: orders.length,
    confirmed: orders.filter((order) => normalizedOrderStatus(order) === "CONFIRMED").length,
    dispatchReady: orders.filter((order) => normalizedOrderStatus(order) === "READY_FOR_DISPATCH").length,
    dispatched: orders.filter((order) => normalizedOrderStatus(order) === "DISPATCHED").length,
    delivered: orders.filter((order) => ["DELIVERED", "COMPLETED"].includes(normalizedOrderStatus(order))).length
  };
}

function orderIdLabel(order) {
  const id = String(order?.orderNumber || order?.orderId || order?.id || "");
  if (!id) return "Order --";
  return `Order ${id.length > 8 ? `#${id.slice(-6).toUpperCase()}` : `#${id.toUpperCase()}`}`;
}

function orderSummaryText(order) {
  return [order?.productType, order?.size, order?.color, order?.customization]
    .filter((value) => value !== null && value !== undefined && String(value).trim())
    .map((value) => String(value).trim())
    .join(" - ") || "Order details pending";
}

function isNearBottom(element, threshold = 96) {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
}

function showNotice(message, isError = false) {
  const notice = $("#notice");
  if (!notice) return;
  notice.textContent = message;
  notice.classList.toggle("error", isError);
  notice.classList.remove("hidden");
  window.setTimeout(() => notice.classList.add("hidden"), 4600);
}

function logDashboardError(context, error, details = {}) {
  const safeDetails = Object.fromEntries(
    Object.entries(details).filter(([key]) => ["status", "path", "leadId", "view", "type"].includes(key))
  );
  console.error(`[Dashboard] ${context}`, {
    message: error instanceof Error ? error.message : String(error),
    ...safeDetails
  });
}

function stableStringify(value) {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.keys(item)
      .sort()
      .reduce((result, key) => {
        result[key] = item[key];
        return result;
      }, {});
  });
}

function setConnectionStatus(status, message = "") {
  state.connectionState = status;
  let indicator = $("#connectionStatus");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = "connectionStatus";
    indicator.className = "connection-status hidden";
    document.body.appendChild(indicator);
  }

  indicator.textContent = message;
  indicator.classList.toggle("hidden", status === "connected");
  indicator.classList.toggle("error", status === "error");
}

async function fetchWithTimeout(resource, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(resource, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Request timed out. Reconnecting...");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function publicApi(path, options = {}) {
  const response = await fetchWithTimeout(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorText = String(data.error || data.message || "").trim();
    const details = typeof data.details === "string" ? data.details.trim() : "";
    const errorDetails = data.details && typeof data.details === "object" ? data.details : {};
    const setupRequired = Boolean(errorDetails.setupRequired || data.setupRequired);
    const setupMessage = errorDetails.message || data.message || "Run the automation database migration before using this section.";
    if (setupRequired) {
      const error = new Error("Setup Required");
      error.setupRequired = true;
      error.setupDetails = {
        ...errorDetails,
        missingTables: errorDetails.missingTables || data.missingTables || [],
        missingLeadColumns: errorDetails.missingLeadColumns || data.missingLeadColumns || [],
        message: setupMessage
      };
      throw error;
    }
    if (response.status === 404) throw new Error(errorText || "That record could not be found.");
    if (response.status === 401) throw new Error("Your session has expired. Please sign in again.");
    if (response.status === 409 && errorText === COMPANY_CONTEXT_MISSING_MESSAGE) throw new Error(COMPANY_CONTEXT_MISSING_MESSAGE);
    if (response.status === 403) {
      if (errorText === COMPANY_CONTEXT_MISSING_MESSAGE) throw new Error(COMPANY_CONTEXT_MISSING_MESSAGE);
      throw new Error(errorDetails.feature ? "Feature disabled by admin." : "Your session is not authorized for this action.");
    }
    if (errorText && !/internal server error/i.test(errorText)) {
      throw new Error(details && !/internal server error/i.test(details) ? `${errorText}: ${details}` : errorText);
    }
    throw new Error("Something went wrong while contacting the server. Please try again.");
  }
  return data;
}

async function dashboardApi() {
  const response = await fetchWithTimeout("/api/dashboard", {
    headers: {
      Accept: "application/json"
    }
  });
  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    logDashboardError("Failed to parse /api/dashboard JSON", error, {
      status: response.status,
      path: "/api/dashboard"
    });
    throw new Error("Command Center API returned invalid JSON");
  }

  if (!response.ok) {
    logDashboardError("/api/dashboard request failed", new Error(data.error || response.statusText), {
      status: response.status,
      path: "/api/dashboard"
    });
    throw new Error("Command Center data could not load");
  }

  return data;
}

async function commandCenterApi(segment = state.selectedPulseSegment) {
  const params = new URLSearchParams();
  if (segment) params.set("segment", segment);
  return publicApi(`/command-center?${params.toString()}`);
}

function buildQuery(params) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) searchParams.set(key, value);
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

function setText(id, value) {
  const element = document.querySelector(`#${id}`);
  if (element && element.textContent !== String(value)) element.textContent = value;
}

function setHtmlIfChanged(element, html) {
  if (!element) return false;
  const nextHtml = String(html);
  if (element.dataset.htmlSignature === nextHtml) return false;
  element.innerHTML = nextHtml;
  element.dataset.htmlSignature = nextHtml;
  return true;
}

function mergeLeads(current = [], incoming = []) {
  const byId = new Map(current.map((lead) => [lead.id, lead]));
  incoming.forEach((lead) => {
    if (!lead?.id) return;
    byId.set(lead.id, { ...(byId.get(lead.id) || {}), ...lead });
  });
  return [...byId.values()].sort(
    (a, b) => new Date(b.lastMessageAt || b.updatedAt || 0).getTime() - new Date(a.lastMessageAt || a.updatedAt || 0).getTime()
  );
}

function htmlToElement(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function syncElement(target, source) {
  [...target.attributes].forEach((attribute) => {
    if (!source.hasAttribute(attribute.name)) target.removeAttribute(attribute.name);
  });
  [...source.attributes].forEach((attribute) => {
    target.setAttribute(attribute.name, attribute.value);
  });
  target.innerHTML = source.innerHTML;
}

function renderKeyedChildren(container, items, keyFn, renderFn, emptyHtml, options = {}) {
  if (!container) return;
  const scrollTop = container.scrollTop;

  if (!items.length) {
    const nextHtml = emptyHtml.trim();
    const nextSignature = `empty:${nextHtml}`;
    if (container.dataset.renderSignature === nextSignature) return false;
    if (container.dataset.emptyState !== "true" || container.innerHTML.trim() !== nextHtml) {
      container.innerHTML = nextHtml;
    }
    container.dataset.emptyState = "true";
    container.dataset.renderSignature = nextSignature;
    return true;
  }

  const existing = new Map(
    [...container.children]
      .filter((child) => child.dataset?.key)
      .map((child) => [child.dataset.key, child])
  );
  const rendered = items
    .map((item) => {
      const key = String(keyFn(item));
      const fresh = htmlToElement(renderFn(item));
      if (!fresh) return null;
      fresh.dataset.key = key;
      const signature = stableStringify({
        key,
        html: fresh.outerHTML,
        data: options.signatureFn ? options.signatureFn(item) : null
      });
      fresh.dataset.renderSignature = signature;
      return { key, fresh, signature };
    })
    .filter(Boolean);
  const nextSignature = stableStringify(rendered.map((item) => [item.key, item.signature]));
  if (container.dataset.renderSignature === nextSignature && container.dataset.emptyState !== "true") return false;

  if (container.dataset.emptyState === "true") {
    container.innerHTML = "";
  }
  container.dataset.emptyState = "false";

  let changed = false;
  let cursor = container.firstElementChild;
  const seen = new Set();

  rendered.forEach(({ key, fresh, signature }) => {
    seen.add(key);
    let node = existing.get(key);
    if (node) {
      if (node.dataset.renderSignature !== signature) {
        syncElement(node, fresh);
        node.dataset.renderSignature = signature;
        changed = true;
      }
    } else {
      node = fresh;
      changed = true;
    }

    if (node !== cursor) {
      container.insertBefore(node, cursor);
      changed = true;
    } else {
      cursor = cursor?.nextElementSibling || null;
    }
  });

  [...container.children].forEach((child) => {
    if (!child.dataset?.key || !seen.has(child.dataset.key)) {
      child.remove();
      changed = true;
    }
  });

  container.dataset.renderSignature = nextSignature;
  container.scrollTop = scrollTop;
  return changed;
}

function bindDelegatedClick(container, key, selector, handler) {
  if (!container) return;
  const listenerKey = `__${key}ClickHandler`;
  if (container[listenerKey]) {
    container.removeEventListener("click", container[listenerKey]);
  }
  container[listenerKey] = (event) => {
    const target = event.target.closest(selector);
    if (!target || !container.contains(target)) return;
    handler(target, event);
  };
  container.addEventListener("click", container[listenerKey]);
}

function captureUiState() {
  return {
    windowScrollY: window.scrollY,
    chatThreadScrollTop: $("#chatThread")?.scrollTop ?? null,
    chatListScrollTop: $("#chatConversationList")?.scrollTop ?? null,
    leadListScrollTop: $("#leadList")?.scrollTop ?? null,
    leadProfileScrollTop: document.querySelector(".lead-profile-panel")?.scrollTop ?? null,
    orderDeskScrollTop: $("#ordersList")?.scrollTop ?? null,
    humanQueueScrollTop: $("#humanQueueFullList")?.scrollTop ?? null,
    replyText: $("#chatReplyText")?.value ?? null,
    activeElementId: document.activeElement?.id || null
  };
}

function restoreUiState(snapshot) {
  requestAnimationFrame(() => {
    if (snapshot.replyText !== null && $("#chatReplyText")) {
      $("#chatReplyText").value = snapshot.replyText;
    }
    if (snapshot.chatThreadScrollTop !== null && $("#chatThread")) {
      $("#chatThread").scrollTop = snapshot.chatThreadScrollTop;
    }
    if (snapshot.chatListScrollTop !== null && $("#chatConversationList")) {
      $("#chatConversationList").scrollTop = snapshot.chatListScrollTop;
    }
    if (snapshot.leadListScrollTop !== null && $("#leadList")) {
      $("#leadList").scrollTop = snapshot.leadListScrollTop;
    }
    const leadProfile = document.querySelector(".lead-profile-panel");
    if (snapshot.leadProfileScrollTop !== null && leadProfile) {
      leadProfile.scrollTop = snapshot.leadProfileScrollTop;
    }
    if (snapshot.orderDeskScrollTop !== null && $("#ordersList")) {
      $("#ordersList").scrollTop = snapshot.orderDeskScrollTop;
    }
    if (snapshot.humanQueueScrollTop !== null && $("#humanQueueFullList")) {
      $("#humanQueueFullList").scrollTop = snapshot.humanQueueScrollTop;
    }
    if (snapshot.activeElementId && document.querySelector(`#${snapshot.activeElementId}`)) {
      document.querySelector(`#${snapshot.activeElementId}`).focus();
    }
    window.scrollTo({ top: snapshot.windowScrollY, behavior: "auto" });
  });
}

function animateCounter(id, nextValue, suffix = "") {
  const element = document.querySelector(`#${id}`);
  if (!element) return;

  const start = Number(element.dataset.value || String(element.textContent).replace(/[^0-9.-]/g, "") || 0);
  const end = Number(nextValue || 0);
  const duration = 620;
  const startedAt = performance.now();
  element.dataset.value = String(end);

  function frame(now) {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = `${Math.round(start + (end - start) * eased)}${suffix}`;
    if (progress < 1) requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function refreshIcons() {
  if (window.lucide?.createIcons) {
    window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
  }
}

function runMotion(selector = ".premium-card, .lead-card") {
  const motionApi = window.Motion || window.motion;
  if (!motionApi?.animate) return;

  document.querySelectorAll(selector).forEach((element, index) => {
    motionApi.animate(
      element,
      { opacity: [0, 1], transform: ["translateY(16px)", "translateY(0px)"] },
      { duration: 0.44, delay: Math.min(index * 0.025, 0.28), easing: "ease-out" }
    );
  });
}

function scoreForLead(lead) {
  const messageCount = Number(lead.messageCount || 0);
  if (messageCount >= 6) return Math.min(99, 84 + Math.min(15, messageCount - 6));
  if (messageCount >= 2) return 50 + messageCount * 5;
  return 18 + messageCount * 6;
}

function getFilteredLeads(forChats = false) {
  const search = (forChats ? state.chatSearch : state.leadSearch).toLowerCase();
  return state.leads.filter((lead) => {
    const matchesTemperature = forChats || !state.temperatureFilter || leadTemperature(lead) === state.temperatureFilter;
    const haystack = `${lead.name} ${lead.source || ""} ${lead.temperatureReason || ""} ${lead.aiInsight || ""} ${lead.lastMessage || ""}`.toLowerCase();
    return matchesTemperature && (!search || haystack.includes(search));
  });
}

function priorityRank(priority) {
  const value = String(priority || "LOW").toUpperCase();
  if (value === "HIGH") return 0;
  if (value === "MEDIUM") return 1;
  return 2;
}

function isHumanQueueLead(lead) {
  return Boolean((lead?.humanTakeoverRequired || lead?.requiresHuman) && !lead?.humanResolvedAt);
}

function humanQueueItems() {
  const byId = new Map();

  state.humanActionQueue.forEach((item) => {
    const leadId = item.leadId || item.id;
    if (!leadId) return;
    byId.set(leadId, {
      leadId,
      name: item.customerName || item.name || "Unknown lead",
      phone: item.phone || "",
      lastMessage: item.lastMessage || "No messages yet",
      reason: item.reason || item.humanReason || "Human takeover requested",
      priority: item.priority || item.humanPriority || "LOW",
      time: item.time || item.lastMessageAt || item.updatedAt,
      messageCount: item.messageCount || 0
    });
  });

  state.leads.filter(isHumanQueueLead).forEach((lead) => {
    byId.set(lead.id, {
      leadId: lead.id,
      name: lead.name,
      phone: lead.phone,
      lastMessage: lead.lastMessage,
      reason: lead.humanReason || "Human takeover requested",
      priority: lead.humanPriority || "LOW",
      time: lead.lastMessageAt || lead.updatedAt,
      messageCount: lead.messageCount || 0
    });
  });

  return [...byId.values()].sort(
    (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime()
  );
}

function fullHumanQueueItems() {
  return humanQueueItems().sort(
    (a, b) => new Date(a.time || 0).getTime() - new Date(b.time || 0).getTime() || priorityRank(a.priority) - priorityRank(b.priority)
  );
}

function humanQueueStats() {
  const items = humanQueueItems();
  const waitMinutes = items
    .map((item) => (item.time ? (Date.now() - new Date(item.time).getTime()) / 60000 : 0))
    .filter((minutes) => Number.isFinite(minutes) && minutes >= 0);
  const averageWait = waitMinutes.length ? waitMinutes.reduce((sum, minutes) => sum + minutes, 0) / waitMinutes.length : 0;
  const today = new Date().toDateString();
  const resolvedToday = state.leads.filter((lead) => lead.humanResolvedAt && new Date(lead.humanResolvedAt).toDateString() === today).length;
  const inProgress = items.filter((item) => /progress|assigned|working/i.test(`${item.status || ""} ${item.reason || ""}`)).length;

  return {
    pending: items.length,
    averageWait,
    highPriority: items.filter((item) => String(item.priority || "").toUpperCase() === "HIGH").length,
    inProgress,
    resolvedToday
  };
}

function renderHumanSummaryCards() {
  const target = $("#humanQueueSummaryCards");
  if (!target) return;
  const stats = humanQueueStats();
  const cards = [
    { key: "pending", label: "Pending Takeover", value: stats.pending, icon: "user-round-check", accent: "ink" },
    { key: "wait", label: "Avg Wait Time", value: durationLabel(stats.averageWait), icon: "clock-3", accent: "amber" },
    { key: "high", label: "High Priority", value: stats.highPriority, icon: "flame", accent: "red" },
    { key: "progress", label: "In Progress", value: stats.inProgress, icon: "messages-square", accent: "blue" },
    { key: "resolved", label: "Resolved Today", value: stats.resolvedToday, icon: "circle-check-big", accent: "green" }
  ];

  renderKeyedChildren(
    target,
    cards,
    (card) => card.key,
    (card) => `
      <article class="human-summary-card ${card.accent}">
        <span><i data-lucide="${card.icon}"></i></span>
        <div>
          <strong>${escapeHtml(card.value)}</strong>
          <small>${escapeHtml(card.label)}</small>
        </div>
      </article>
    `,
    ""
  );
}

function humanActionRow(item) {
  return `
    <article class="human-action-row compact-human-row takeover-row">
      <span class="lead-avatar">${escapeHtml(item.name).slice(0, 1).toUpperCase()}</span>
      <span class="human-main">
        <span class="human-top">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.phone)}</span>
        </span>
        <span class="conversation-preview-text">${escapeHtml(chatPreviewText(item.lastMessage))}</span>
        <span class="conversation-preview-phone">${escapeHtml(item.reason || "Human takeover requested")}</span>
      </span>
      <span class="human-meta">
        <time>${relativeTime(item.time)}</time>
        <span class="priority-badge ${String(item.priority || "LOW").toLowerCase()}">${pretty(item.priority || "LOW")}</span>
      </span>
      <span class="row-actions">
        <button class="secondary-button compact-action" type="button" data-open-chat="${item.leadId}">
          <i data-lucide="messages-square"></i>
          Open Chat
        </button>
        <button class="secondary-button compact-action" type="button" data-resolve-human="${item.leadId}">
          <i data-lucide="check-circle-2"></i>
          Resolve
        </button>
        <button class="secondary-button compact-action" type="button" data-return-ai="${item.leadId}">
          <i data-lucide="bot"></i>
          Return to AI
        </button>
      </span>
    </article>
  `;
}

function renderHumanActionQueue() {
  const list = $("#humanActionQueueList");
  if (!list) return;
  const items = humanQueueItems();

  renderKeyedChildren(
    list,
    items,
    (item) => item.leadId,
    humanActionRow,
    emptyState("No human takeover needed right now.", "New customer requests for human help will appear here.")
  );
  bindDelegatedClick(list, "humanOverviewOpenChat", "[data-open-chat]", (button) => openLeadChat(button.dataset.openChat));
  bindDelegatedClick(list, "humanOverviewResolve", "[data-resolve-human]", (button) => resolveHumanAction(button.dataset.resolveHuman));
  bindDelegatedClick(list, "humanOverviewReturnAi", "[data-return-ai]", (button) => resolveHumanAction(button.dataset.returnAi));
}

function conversationPreviewRow(lead) {
  const temperature = leadTemperature(lead);
  return `
    <button class="conversation-preview-row" data-open-chat="${lead.id}">
      <span class="lead-avatar">${escapeHtml(lead.name).slice(0, 1).toUpperCase()}</span>
      <span class="conversation-preview-main">
        <span class="conversation-preview-top">
          <strong>${escapeHtml(lead.name)}</strong>
          <span class="tag ${temperature.toLowerCase()}">${pretty(temperature)}</span>
        </span>
        <span class="conversation-preview-text">${escapeHtml(previewText(lead.lastMessage))}</span>
      </span>
      <span class="conversation-preview-meta">
        <time>${relativeTime(lead.updatedAt)}</time>
        <small>${messageCountLabel(lead)}</small>
      </span>
      <i data-lucide="arrow-up-right"></i>
    </button>
  `;
}

function renderRecentConversationList(leads = []) {
  const list = $("#recentConversationList");
  if (!list) return;

  const recent = [...leads]
    .sort((a, b) => new Date(b.lastMessageAt || b.updatedAt).getTime() - new Date(a.lastMessageAt || a.updatedAt).getTime())
    .slice(0, 5);

  renderKeyedChildren(
    list,
    recent,
    (lead) => lead.id,
    conversationPreviewRow,
    emptyState("No recent conversations", "Recent WhatsApp threads will appear here.")
  );
  bindDelegatedClick(list, "recentConversationOpenChat", "[data-open-chat]", (button) => openLeadChat(button.dataset.openChat));
}

function renderLeadGrowthChart(stats = {}) {
  const chart = $("#leadGrowthChart");
  if (!chart) return;
  const values = [
    Number(stats.scrapLeads || 0),
    Number(stats.warmLeads || 0),
    Number(stats.hotLeads || 0),
    Number(stats.totalLeads || 0)
  ];
  const max = Math.max(1, ...values);
  const points = values
    .map((value, index) => `${12 + index * 28},${86 - Math.round((value / max) * 62)}`)
    .join(" ");
  setHtmlIfChanged(
    chart,
    `
    <svg viewBox="0 0 100 100" role="img" aria-label="Lead growth trend">
      <defs><linearGradient id="leadGlow" x1="0" x2="1"><stop stop-color="var(--whatsapp)"/><stop offset="1" stop-color="var(--signal)"/></linearGradient></defs>
      <polyline points="${points}" fill="none" stroke="url(#leadGlow)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>
      ${values
        .map((value, index) => `<circle cx="${12 + index * 28}" cy="${86 - Math.round((value / max) * 62)}" r="3.5"></circle>`)
        .join("")}
    </svg>
    <div class="chart-caption"><span>Scrap</span><span>Warm</span><span>Hot</span><span>Total</span></div>
  `
  );
}

function failedSendCount(data = state.latestOverview) {
  return (data?.recentLogs || []).filter((log) => /failed?/i.test(`${log.status || ""} ${log.errorMessage || ""}`)).length;
}

function latestSyncLabel(data = state.latestOverview) {
  const times = [
    ...(data?.recentLogs || []).map((log) => log.createdAt),
    ...(data?.recentLeads || []).map((lead) => lead.lastMessageAt || lead.updatedAt)
  ]
    .filter(Boolean)
    .map((time) => new Date(time).getTime())
    .filter((time) => Number.isFinite(time));

  if (!times.length) return "No sync yet";
  return relativeTime(new Date(Math.max(...times)).toISOString());
}

function renderTemperatureDistribution(stats = {}) {
  const target = $("#temperatureDistribution");
  if (!target) return;
  const total = Math.max(1, Number(stats.totalLeads || 0));
  const items = [
    ["Hot", Number(stats.hotLeads || 0), "hot"],
    ["Warm", Number(stats.warmLeads || 0), "warm"],
    ["Scrap", Number(stats.scrapLeads || 0), "scrap"]
  ];
  setHtmlIfChanged(
    target,
    `
    <div class="distribution-meter">
      ${items
        .map(([, count, key]) => `<span class="${key}" style="width:${Math.max(4, Math.round((count / total) * 100))}%"></span>`)
        .join("")}
    </div>
    <div class="distribution-legend">
      ${items
        .map(([label, count, key]) => `<div><i class="${key}"></i><strong>${count}</strong><span>${label}</span></div>`)
        .join("")}
    </div>
  `
  );
}

function renderResponsePerformance(stats = {}) {
  const target = $("#responsePerformance");
  if (!target) return;
  const inbound = Number(stats.inboundMessages || 0);
  const outbound = Number(stats.outboundMessages || 0);
  const replyRate = inbound ? Math.min(100, Math.round((outbound / inbound) * 100)) : 0;
  const humanPressure = Math.min(100, Math.round((humanQueueItems().length / Math.max(1, Number(stats.totalLeads || 0))) * 100));
  setHtmlIfChanged(
    target,
    `
    <div class="performance-ring" style="--value:${replyRate}">
      <strong>${replyRate}%</strong>
      <span>Reply coverage</span>
    </div>
    <div class="performance-lines">
      <div><span>Human pressure</span><b>${humanPressure}%</b><i><em style="width:${humanPressure}%"></em></i></div>
      <div><span>Automation coverage</span><b>${Math.max(0, 100 - humanPressure)}%</b><i><em style="width:${Math.max(0, 100 - humanPressure)}%"></em></i></div>
    </div>
  `
  );
}

function renderLeadSourceDistribution() {
  const target = $("#leadSourceDistribution");
  if (!target) return;
  const counts = state.leads.reduce((map, lead) => {
    const source = lead.source || "WhatsApp";
    map.set(source, (map.get(source) || 0) + 1);
    return map;
  }, new Map());
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const total = Math.max(1, rows.reduce((sum, [, count]) => sum + count, 0));
  setHtmlIfChanged(
    target,
    rows.length
      ? `<div class="source-bars">${rows.map(([source, count]) => `
        <div class="source-bar-row">
          <span>${escapeHtml(source)}</span>
          <i><em style="width:${Math.max(6, Math.round((count / total) * 100))}%"></em></i>
          <strong>${count}</strong>
        </div>
      `).join("")}</div>`
      : emptyState("No lead sources yet.", "Lead source distribution appears after real leads are imported.")
  );
}

function renderMessageActivityTrend(stats = {}) {
  const target = $("#messageActivityTrend");
  if (!target) return;
  const inbound = Number(stats.inboundMessages || 0);
  const outbound = Number(stats.outboundMessages || 0);
  const total = Math.max(1, inbound + outbound);
  setHtmlIfChanged(
    target,
    `
      <div class="activity-bars">
        <div><span>Inbound</span><strong>${inbound}</strong><i><em style="width:${Math.max(4, Math.round((inbound / total) * 100))}%"></em></i></div>
        <div><span>Outbound</span><strong>${outbound}</strong><i><em style="width:${Math.max(4, Math.round((outbound / total) * 100))}%"></em></i></div>
      </div>
    `
  );
}

function renderAnalytics(stats = {}) {
  renderLeadGrowthChart(stats);
  renderTemperatureDistribution(stats);
  renderResponsePerformance(stats);
  renderLeadSourceDistribution();
  renderMessageActivityTrend(stats);
  const reportsLeadMix = $("#reportsLeadMix");
  const reportsResponse = $("#reportsResponse");
  if (reportsLeadMix) setHtmlIfChanged(reportsLeadMix, $("#temperatureDistribution")?.innerHTML || "");
  if (reportsResponse) setHtmlIfChanged(reportsResponse, $("#responsePerformance")?.innerHTML || "");
  renderReports();
}

function metricRows(rows = []) {
  return rows.map((row) => `
    <div class="report-metric-row">
      <span>${escapeHtml(row.label)}</span>
      <strong>${escapeHtml(row.value)}</strong>
    </div>
  `).join("") || emptyState("No data yet.", "This report fills from real workspace activity.");
}

function renderReports() {
  const broadcastTotals = state.bulkJobs.reduce((result, job) => ({
    jobs: result.jobs + 1,
    sent: result.sent + Number(job.sentCount || 0),
    failed: result.failed + Number(job.failedCount || 0),
    queued: result.queued + Number(job.queuedCount || 0)
  }), { jobs: 0, sent: 0, failed: 0, queued: 0 });
  const campaignTotals = state.campaigns.reduce((result, campaign) => ({
    campaigns: result.campaigns + 1,
    sent: result.sent + Number(campaign.sent || 0),
    failed: result.failed + Number(campaign.failed || 0),
    replies: result.replies + Number(campaign.replies || 0)
  }), { campaigns: 0, sent: 0, failed: 0, replies: 0 });
  const orderStats = orderDeskStats();
  setHtmlIfChanged($("#reportsBroadcastPerformance"), metricRows([
    { label: "Broadcast jobs", value: broadcastTotals.jobs },
    { label: "Sent", value: broadcastTotals.sent },
    { label: "Queued", value: broadcastTotals.queued },
    { label: "Failed", value: broadcastTotals.failed }
  ]));
  setHtmlIfChanged($("#reportsCampaignPerformance"), metricRows([
    { label: "Campaigns", value: campaignTotals.campaigns },
    { label: "Sent", value: campaignTotals.sent },
    { label: "Replies", value: campaignTotals.replies },
    { label: "Failed", value: campaignTotals.failed }
  ]));
  setHtmlIfChanged($("#reportsFlowPerformance"), metricRows([
    { label: "Flows", value: state.workflows.length },
    { label: "Active", value: state.workflows.filter((workflow) => workflow.isActive).length },
    { label: "Logs", value: state.workflows.reduce((sum, workflow) => sum + Number(workflow.executionLogs?.length || 0), 0) }
  ]));
  setHtmlIfChanged($("#reportsOrderMovement"), metricRows([
    { label: "Total orders", value: orderStats.total },
    { label: "Confirmed", value: orderStats.confirmed },
    { label: "Dispatch ready", value: orderStats.dispatchReady },
    { label: "Dispatched", value: orderStats.dispatched }
  ]));
}

function renderWorkspaceInsights(data = state.latestOverview) {
  const list = $("#workspaceInsightsList");
  if (!list) return;
  const stats = data?.stats || {};
  const activeChats = Number(stats.activeChats ?? state.leads.filter((lead) => Number(lead.messageCount || 0) > 0).length);
  const failedSends = failedSendCount(data);
  const humanCount = humanQueueItems().length;
  const ordersDone = ordersDoneCount();
  const totalMessages = Number(stats.inboundMessages || 0) + Number(stats.outboundMessages || 0);
  const latestLead = (data?.recentLeads || [])[0];
  const latestLog = (data?.recentLogs || [])[0];

  const items = [
    {
      label: "Total leads",
      value: Number(stats.totalLeads || state.leads.length || 0),
      detail: "Imported records currently tracked."
    },
    {
      label: "Active conversations",
      value: activeChats,
      detail: `${totalMessages} WhatsApp message${totalMessages === 1 ? "" : "s"} logged.`
    },
    {
      label: "Pending human replies",
      value: humanCount,
      detail: humanCount ? "Manual follow-up is waiting." : "No human takeover needed right now."
    },
    {
      label: "Orders done",
      value: ordersDone,
      detail: "Confirmed, dispatched, delivered, or completed."
    },
    {
      label: "Failed sends",
      value: failedSends,
      detail: failedSends ? "Review recent send logs." : "No failed sends in recent logs."
    },
    {
      label: "Latest sync",
      value: latestSyncLabel(data),
      detail: latestLog ? `${latestLog.action || "Workspace"} - ${latestLog.status || "updated"}` : "Waiting for the next workspace event."
    },
    {
      label: "Latest lead movement",
      value: latestLead ? relativeTime(latestLead.lastMessageAt || latestLead.updatedAt) : "--",
      detail: latestLead ? `${latestLead.name}: ${chatPreviewText(latestLead.lastMessage)}` : "No recent lead movement yet."
    }
  ];

  renderKeyedChildren(
    list,
    items,
    (item) => item.label,
    (item) => `
      <article class="workspace-insight-row">
        <span>
          <strong>${escapeHtml(item.label)}</strong>
          <small>${escapeHtml(item.detail)}</small>
        </span>
        <b>${escapeHtml(item.value)}</b>
      </article>
    `,
    emptyState("Workspace insights will appear here.", "Import leads or send welcomes to populate operational stats.")
  );
}

function renderHumanQueueViews() {
  renderHumanActionQueue();
  const fullList = $("#humanQueueFullList");
  renderHumanSummaryCards();
  if (!fullList) return;
  const items = fullHumanQueueItems();
  setText("humanQueueListCount", `${items.length} Conversation${items.length === 1 ? "" : "s"}`);
  renderKeyedChildren(
    fullList,
    items,
    (item) => item.leadId,
    humanActionRow,
    emptyState("No conversations need human takeover.", "Priority handoffs will appear here automatically.")
  );
  bindDelegatedClick(fullList, "humanFullOpenChat", "[data-open-chat]", (button) => openLeadChat(button.dataset.openChat));
  bindDelegatedClick(fullList, "humanFullResolve", "[data-resolve-human]", (button) => resolveHumanAction(button.dataset.resolveHuman));
  bindDelegatedClick(fullList, "humanFullReturnAi", "[data-return-ai]", (button) => resolveHumanAction(button.dataset.returnAi));
  refreshIcons();
}

function renderOrderSummaryCards() {
  const target = $("#orderDeskSummaryCards");
  if (!target) return;
  const stats = orderDeskStats();
  const cards = [
    { key: "total", label: "Total Orders", value: stats.total, icon: "package", accent: "ink" },
    { key: "confirmed", label: "Confirmed", value: stats.confirmed, icon: "circle-check-big", accent: "green" },
    { key: "dispatch", label: "Dispatch Ready", value: stats.dispatchReady, icon: "truck", accent: "blue" },
    { key: "dispatched", label: "Dispatched", value: stats.dispatched, icon: "send", accent: "amber" },
    { key: "delivered", label: "Delivered", value: stats.delivered, icon: "badge-check", accent: "green" }
  ];

  renderKeyedChildren(
    target,
    cards,
    (card) => card.key,
    (card) => `
      <article class="order-summary-card ${card.accent}">
        <span><i data-lucide="${card.icon}"></i></span>
        <div>
          <strong>${escapeHtml(card.value)}</strong>
          <small>${escapeHtml(card.label)}</small>
        </div>
      </article>
    `,
    ""
  );
}

function renderOrdersView() {
  const list = $("#ordersList");
  renderOrderSummaryCards();
  if (!list) return;
  const orders = flattenOrders().sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  setText("ordersListCount", `${orders.length} Order${orders.length === 1 ? "" : "s"}`);
  renderKeyedChildren(
    list,
    orders,
    (order) => order.id || order.leadId,
    (order) => `
      <article class="order-desk-row">
        <span class="lead-avatar">${escapeHtml(order.customerName || "O").slice(0, 1).toUpperCase()}</span>
        <span class="order-row-main">
          <span class="order-row-top">
            <strong>${escapeHtml(order.customerName || "Customer")}</strong>
            <small>${escapeHtml(order.phone || "")}</small>
            <em>${escapeHtml(orderIdLabel(order))}</em>
          </span>
          <span class="order-row-summary">${escapeHtml(orderSummaryText(order))}</span>
          <span class="order-row-meta">
            <span><i data-lucide="hash"></i>Qty ${escapeHtml(emptyValue(order.quantity))}</span>
            <span><i data-lucide="ruler"></i>Size ${escapeHtml(emptyValue(order.size))}</span>
            <span><i data-lucide="palette"></i>${escapeHtml(emptyValue(order.color))}</span>
            <span><i data-lucide="map-pin"></i>${escapeHtml(emptyValue(order.deliveryLocation))}</span>
            <span><i data-lucide="activity"></i>${confidenceLabel(order.confidenceScore)} confidence</span>
          </span>
        </span>
        <span class="order-row-state">
          <span class="status-badge ${orderStatusClass(order.status)}">${formatOrderStatus(order.status)}</span>
          <time>${relativeTime(order.updatedAt)}</time>
        </span>
        <span class="order-row-actions">
          <button class="secondary-button" type="button" data-order-id="${order.id}" data-next-action="CONFIRM">Confirm Order</button>
          <button class="secondary-button" type="button" data-order-id="${order.id}" data-next-action="READY_FOR_DISPATCH">Dispatch Ready</button>
          <button class="secondary-button" type="button" data-order-id="${order.id}" data-next-action="DISPATCH">Mark Dispatched</button>
          <button class="ghost-action" type="button" data-open-chat="${order.leadId}">
            <i data-lucide="messages-square"></i>
            Open Chat
          </button>
        </span>
      </article>
          `,
    emptyState("No orders yet.", "Order cards will appear once WhatsApp conversations include product details.")
  );
  bindDelegatedClick(list, "ordersOpenChat", "[data-open-chat]", (button) => openLeadChat(button.dataset.openChat));
  bindDelegatedClick(list, "ordersAction", "[data-order-id][data-next-action]", (button) => {
    performOrderAction(button.dataset.orderId, button.dataset.nextAction, button);
  });
  refreshIcons();
  renderReports();
}

function renderConversationIntel(recentLeads = []) {
  renderHumanQueueViews();
}

function renderRecentConversations(recentLeads = []) {
  renderRecentConversationList(recentLeads);
}

function commandCenterSegmentLabel(key) {
  return {
    all_attention: "all attention",
    inbox: "inbox",
    orders: "orders",
    ai_handoffs: "AI handoffs",
    human_queue: "human queue",
    campaign_replies: "campaigns / broadcasts"
  }[key] || pretty(key);
}

function commandCenterSegmentMeaning(key) {
  return {
    all_attention: "All live signals across conversations, orders, AI handoffs, human queue, and campaigns.",
    inbox: "Inbound customer replies and active WhatsApp threads that may need response.",
    orders: "Order conversations where confirmation, review, quotation, or details are still moving.",
    ai_handoffs: "AI workflow failures and automation uncertainty that needs operator review.",
    human_queue: "Conversations explicitly waiting for a human owner or takeover decision.",
    campaign_replies: "Campaign replies, broadcast delivery failures, and post-send movement."
  }[key] || "Operational signal from the Command Center.";
}

function commandCenterItemById(id) {
  return (state.commandCenter?.priorityQueue?.items || []).find((item) => item.id === id) || null;
}

function commandCenterContextForSelected(commandCenter = state.commandCenter) {
  const contexts = commandCenter?.context?.items || [];
  return contexts.find((context) => context.priorityItemId === state.selectedPriorityItemId)
    || commandCenter?.context?.default
    || null;
}

function syncSelectedPriorityItem(commandCenter = state.commandCenter) {
  const items = commandCenter?.priorityQueue?.items || [];
  if (!items.length) {
    state.selectedPriorityItemId = null;
    return null;
  }
  const existing = items.find((item) => item.id === state.selectedPriorityItemId);
  const selected = existing || items.find((item) => item.id === commandCenter?.priorityQueue?.selectedPriorityItemId) || items[0];
  state.selectedPriorityItemId = selected.id;
  return selected;
}

function activateCommandCenterTarget(target) {
  if (!target) return;
  const view = target.targetView || "chats";
  const objectId = target.objectId;
  if (!featureEnabledForView(view)) {
    showNotice("Feature disabled by admin.", true);
    return;
  }
  if (view === "chats" && target.objectType === "Lead" && objectId) {
    openLeadChat(objectId).catch((error) => {
      logDashboardError("Context Surface action failed", error, { objectId });
      showNotice("Could not open this linked work yet.", true);
    });
    return;
  }
  switchView(view);
}

function setCommandCenterLoading(isLoading) {
  state.isLoadingCommandCenter = isLoading;
  const surface = document.querySelector(".command-center-phase-a");
  surface?.classList.toggle("is-loading", Boolean(isLoading));
  if (isLoading) setText("commandCenterFreshness", "Refreshing live signals...");
}

function renderCommandCenterFreshness(commandCenter = state.commandCenter) {
  const element = $("#commandCenterFreshness");
  if (!element) return;
  const updatedAt = commandCenter?.lastUpdatedAt || state.commandCenterLastUpdatedAt;
  if (!updatedAt) {
    element.textContent = "Waiting for live signal...";
    element.classList.add("stale");
    return;
  }
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const isStale = ageMs > 60000;
  element.classList.toggle("stale", isStale);
  element.textContent = `${isStale ? "Stale signal" : "Live signal"} - updated ${relativeTime(updatedAt)}`;
}

function renderConversationPulse(commandCenter = state.commandCenter) {
  const target = $("#conversationPulse");
  if (!target) return;
  const segments = commandCenter?.pulse?.segments || [];

  if (!segments.length) {
    setHtmlIfChanged(target, emptyState("No pulse signals yet.", "Conversation Pulse will appear once real activity exists."));
    return;
  }

  const html = `
    <button class="pulse-spine-empty-target" type="button" data-pulse-empty="true" aria-label="View all attention signals"></button>
    <div class="pulse-spine-track" aria-hidden="true"></div>
    <div class="pulse-spine-segments">
      ${segments.map((segment) => {
        const intensity = Math.max(8, Math.min(100, Number(segment.intensity || 0)));
        const width = segment.active ? Math.max(1.4, intensity / 22) : Math.max(0.72, intensity / 34);
        const weight = Math.max(10, Math.min(100, intensity));
      return `
        <button
          class="conversation-pulse-segment ${segment.active ? "active" : ""} ${escapeHtml(segment.severity || "quiet")}"
          type="button"
          data-pulse-segment="${escapeHtml(segment.key)}"
          data-pulse-meaning="${escapeHtml(commandCenterSegmentMeaning(segment.key))}"
          style="--segment-width:${width}; --segment-intensity:${intensity}%; --segment-weight:${weight}%;"
          aria-pressed="${segment.active ? "true" : "false"}"
          title="${escapeHtml(commandCenterSegmentMeaning(segment.key))}"
        >
          <span class="pulse-marker"></span>
          <span class="pulse-segment-copy">
            <strong>${escapeHtml(segment.label)}</strong>
            <small>${Number(segment.count || 0)} signal${Number(segment.count || 0) === 1 ? "" : "s"}</small>
          </span>
        </button>
      `;
      }).join("")}
    </div>
  `;

  setHtmlIfChanged(target, html);
  const explainer = $("#pulseHoverExplainer");
  bindDelegatedClick(target, "conversationPulseEmpty", "[data-pulse-empty]", () => {
    if (state.selectedPulseSegment === "all_attention") return;
    loadCommandCenter("all_attention").catch((error) => {
      logDashboardError("Command Center all-attention load failed", error);
      showNotice("Conversation Pulse could not reset. Existing signals will stay visible.", true);
    });
  });
  bindDelegatedClick(target, "conversationPulseSegment", "[data-pulse-segment]", (button) => {
    const segment = button.dataset.pulseSegment || "all_attention";
    if (segment === state.selectedPulseSegment && state.commandCenter?.pulse?.activeSegment === segment) return;
    loadCommandCenter(segment).catch((error) => {
      logDashboardError("Command Center segment load failed", error, { segment });
      showNotice("Conversation Pulse could not refresh. Existing signals will stay visible.", true);
    });
  });
  target.onmouseover = (event) => {
    const segment = event.target.closest("[data-pulse-segment]");
    if (!segment || !target.contains(segment)) return;
    if (explainer) explainer.textContent = segment.dataset.pulseMeaning || "Operational signal from the Command Center.";
  };

  target.onmouseout = (event) => {
    const segment = event.target.closest("[data-pulse-segment]");
    if (!segment || !target.contains(segment)) return;
    const nextSegment = event.relatedTarget?.closest?.("[data-pulse-segment]");
    if (nextSegment === segment) return;
    if (explainer) explainer.textContent = "Hover a pulse segment to inspect what the signal means.";
  };
}

function prioritySeverityLabel(severity) {
  return {
    critical: "Critical",
    warning: "Warning",
    live: "Live",
    quiet: "Quiet"
  }[severity] || pretty(severity);
}

function priorityQueueRow(item) {
  const selected = state.selectedPriorityItemId === item.id;
  return `
    <article class="priority-queue-row ${selected ? "selected" : ""} ${escapeHtml(item.severity || "quiet")}" data-priority-item="${escapeHtml(item.id)}">
      <span class="priority-state-rail"></span>
      <div class="priority-row-main">
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.summary || "")}</small>
        </div>
        <div class="priority-row-meta">
          <span>${escapeHtml(item.module || "Command")}</span>
          <span>${escapeHtml(prioritySeverityLabel(item.severity))}</span>
          <span>${escapeHtml(relativeTime(item.updatedAt))}</span>
        </div>
      </div>
      <button class="priority-row-action" type="button" data-priority-action="${escapeHtml(item.id)}">${escapeHtml(item.recommendedAction || "Review")}</button>
    </article>
  `;
}

function renderPriorityQueue(commandCenter = state.commandCenter) {
  const target = $("#commandCenterPriorityQueue");
  if (!target) return;
  const items = commandCenter?.priorityQueue?.items || [];
  const segment = commandCenter?.selectedPulseSegment || state.selectedPulseSegment;
  syncSelectedPriorityItem(commandCenter);

  setText("commandCenterFilterLabel", `Viewing ${commandCenterSegmentLabel(segment)} signals`);
  setText(
    "commandCenterQueueCount",
    `${items.length} attention item${items.length === 1 ? "" : "s"} in this lens`
  );

  if (!items.length) {
    setHtmlIfChanged(
      target,
      emptyState("No attention items in this lens.", "Choose another pulse segment or wait for new operational activity.")
    );
    return;
  }

  setHtmlIfChanged(target, items.map(priorityQueueRow).join(""));
  bindDelegatedClick(target, "prioritySelect", "[data-priority-item]", (row) => {
    state.selectedPriorityItemId = row.dataset.priorityItem || null;
    renderPriorityQueue();
    renderContextSurface();
  });
  bindDelegatedClick(target, "priorityAction", "[data-priority-action]", (button, event) => {
    event.stopPropagation();
    state.selectedPriorityItemId = button.dataset.priorityAction || null;
    const item = commandCenterItemById(state.selectedPriorityItemId);
    renderPriorityQueue();
    renderContextSurface();
    activatePriorityItem(item);
  });
}

function contextTargetAttrs(target) {
  if (!target) return "";
  return [
    `data-context-view="${escapeHtml(target.targetView || "")}"`,
    `data-context-object-type="${escapeHtml(target.objectType || "")}"`,
    `data-context-object-id="${escapeHtml(target.objectId || "")}"`
  ].join(" ");
}

function renderContextSurface(commandCenter = state.commandCenter) {
  const target = $("#commandCenterContextSurface");
  if (!target) return;
  const context = commandCenterContextForSelected(commandCenter);

  if (!context) {
    setHtmlIfChanged(
      target,
      emptyState("No interpreter signal yet.", "Select a priority item to see what happened, why it matters, and where to act.")
    );
    return;
  }

  const action = context.recommendedAction;
  const linkedWork = context.linkedWork || [];
  const trail = context.resolutionTrail || [];

  setHtmlIfChanged(target, `
    <div class="context-surface-head">
      <strong>${escapeHtml(context.title || "Selected signal")}</strong>
      <span>${escapeHtml(context.source || commandCenterSegmentLabel(context.pulseSegment))}</span>
    </div>

    <div class="context-explainer-stack">
      <section>
        <p>What Happened</p>
        <span>${escapeHtml(context.whatHappened || "No event explanation available.")}</span>
      </section>
      <section>
        <p>Why It Matters</p>
        <span>${escapeHtml(context.whyItMatters || "No operational impact available.")}</span>
      </section>
    </div>

    <div class="context-action-block">
      <p>Recommended Action</p>
      ${action ? `
        <button class="context-primary-action" type="button" ${contextTargetAttrs(action)}>
          <span>${escapeHtml(action.label || "Review")}</span>
          <small>${escapeHtml(action.targetLabel || "Inbox")}</small>
        </button>
      ` : `<span class="context-muted">No action needed in this lens.</span>`}
    </div>

    <div class="context-linked-work">
      <p>Linked Work</p>
      ${linkedWork.length ? linkedWork.map((link) => `
        <button class="context-work-link" type="button" ${contextTargetAttrs(link)}>
          <span>${escapeHtml(link.label || link.module || "Linked work")}</span>
          <small>${escapeHtml(link.module || "")}</small>
        </button>
      `).join("") : `<span class="context-muted">No linked work available.</span>`}
    </div>

    <div class="context-resolution-trail">
      <p>Resolution Trail</p>
      ${trail.length ? trail.map((entry) => `<span>${escapeHtml(entry)}</span>`).join("") : `<span>No trail recorded yet.</span>`}
    </div>
  `);

  bindDelegatedClick(target, "contextPrimaryAction", "[data-context-view]", (button) => {
    activateCommandCenterTarget({
      targetView: button.dataset.contextView,
      objectType: button.dataset.contextObjectType,
      objectId: button.dataset.contextObjectId
    });
  });
}

function renderSecondarySignals(commandCenter = state.commandCenter) {
  const target = $("#commandCenterSecondarySignals");
  if (!target) return;
  const signals = commandCenter?.secondarySignals || [];
  setHtmlIfChanged(
    target,
    signals.length
      ? signals.map((signal) => `
        <div class="secondary-signal-row ${escapeHtml(signal.tone || "quiet")}">
          <span>${escapeHtml(signal.statement || "")}</span>
        </div>
      `).join("")
      : emptyState("No secondary signals yet.", "Supporting signals will appear after real activity is recorded.")
  );
}

function renderCommandCenter(commandCenter = state.commandCenter) {
  if (!commandCenter) return;
  state.commandCenter = commandCenter;
  state.selectedPulseSegment = commandCenter.selectedPulseSegment || commandCenter.pulse?.activeSegment || state.selectedPulseSegment;
  state.commandCenterLastUpdatedAt = commandCenter.lastUpdatedAt || state.commandCenterLastUpdatedAt;
  syncSelectedPriorityItem(commandCenter);
  const total = Number(commandCenter.priorityQueue?.totalCount || 0);

  setText("commandCenterQuestion", commandCenter.question || "What needs attention now?");
  setText(
    "commandCenterSummary",
    total
      ? `${total} real attention signal${total === 1 ? "" : "s"} across conversations, orders, AI, and campaigns.`
      : "No active attention signals across conversations, orders, AI, and campaigns."
  );
  renderConversationPulse(commandCenter);
  renderPriorityQueue(commandCenter);
  renderContextSurface(commandCenter);
  renderSecondarySignals(commandCenter);
  renderCommandCenterFreshness(commandCenter);
  refreshIcons();
}

function renderDerivedOverview() {
  if (!state.latestOverview) return;

  const { stats, recentLeads } = state.latestOverview;
  const totalMessages = (stats.inboundMessages || 0) + (stats.outboundMessages || 0);
  const total = Math.max(1, stats.totalLeads || 0);
  const activeChats = Number(stats.activeChats ?? state.leads.filter((lead) => Number(lead.messageCount || 0) > 0).length);
  const humanCount = humanQueueItems().length;
  const ordersDone = ordersDoneCount();

  setText("sidebarSummary", `${stats.hotLeads} hot / ${stats.warmLeads} warm / ${stats.scrapLeads} scrap`);
  const meter = $("#sidebarMeter");
  if (meter) meter.style.width = `${Math.max(8, Math.round((stats.hotLeads / total) * 100))}%`;

  setText(
    "dashboardHeroSummary",
    `Lead analytics from real WhatsApp activity. ${activeChats} active chat${activeChats === 1 ? "" : "s"} and ${totalMessages} message${totalMessages === 1 ? "" : "s"} logged.`
  );
  setText("hotLeadTrend", `${Math.round((stats.hotLeads / total) * 100)}% hot`);
  setText("warmLeadTrend", `${Math.round((stats.warmLeads / total) * 100)}% warm`);
  setText("scrapLeadTrend", `${Math.round((stats.scrapLeads / total) * 100)}% scrap`);
  setText("humanTakeoverTrend", humanCount ? `${humanCount} waiting` : "Clear");
  setText("ordersDoneTrend", ordersDone ? `${ordersDone} ready` : "No completed orders");
  animateCounter("totalLeads", stats.totalLeads || state.leads.length || 0);
  animateCounter("hotLeads", stats.hotLeads);
  animateCounter("warmLeads", stats.warmLeads);
  animateCounter("scrapLeads", stats.scrapLeads);
  animateCounter("humanQueueCount", humanCount);
  animateCounter("ordersDone", ordersDone);
  setText("hotLeadInsight", `${stats.hotLeads} lead${stats.hotLeads === 1 ? "" : "s"} with 6+ messages deserve same-day follow-up.`);
  setText("warmLeadInsight", `${stats.warmLeads} account${stats.warmLeads === 1 ? "" : "s"} with 2-5 messages need nurture.`);
  setText("scrapLeadInsight", `${stats.scrapLeads} record${stats.scrapLeads === 1 ? "" : "s"} under 2 messages stay low priority.`);
  setText("totalLeadInsight", `${stats.totalLeads || state.leads.length || 0} real lead${(stats.totalLeads || state.leads.length || 0) === 1 ? "" : "s"} currently tracked.`);
  setText("humanQueueInsight", humanCount ? `${humanCount} conversation${humanCount === 1 ? "" : "s"} need manual attention.` : "No human takeover needed right now.");
  setText("ordersDoneInsight", `${ordersDone} confirmed, dispatched, delivered, or completed order${ordersDone === 1 ? "" : "s"}.`);

  renderAnalytics(stats);
  renderWorkspaceInsights(state.latestOverview);
  renderOrdersView();
  renderConversationIntel(recentLeads);
  renderRecentConversations(recentLeads);
}

function renderOverview(data) {
  const stats = data.stats || {
    totalLeads: data.totalLeads || 0,
    hotLeads: data.hotLeads || 0,
    warmLeads: data.warmLeads || 0,
    scrapLeads: data.scrapLeads || 0,
    activeChats: data.activeChats || 0,
    inboundMessages: data.inboundMessages || 0,
    outboundMessages: data.outboundMessages || 0
  };
  data.stats = stats;
  state.latestOverview = data;
  $("#overviewSkeleton").classList.add("hidden");
  $("#overviewContent").classList.remove("hidden");
  state.overviewLoaded = true;

  animateCounter("hotLeads", stats.hotLeads);
  animateCounter("warmLeads", stats.warmLeads);
  animateCounter("scrapLeads", stats.scrapLeads);
  renderDerivedOverview();
  renderCommandCenter();
  refreshIcons();
  runMotion();
}

function emptyState(title, text) {
  return `<article class="empty-card"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></article>`;
}

function emptyOverviewData() {
  return {
    stats: {
      totalLeads: 0,
      hotLeads: 0,
      warmLeads: 0,
      scrapLeads: 0,
      activeChats: 0,
      inboundMessages: 0,
      outboundMessages: 0
    },
    recentLeads: [],
    recentConversations: [],
    humanActionQueue: [],
    orderPipeline: {}
  };
}

function emptyCommandCenterData(segment = state.selectedPulseSegment || "all_attention") {
  const segmentKeys = ["all_attention", "inbox", "orders", "ai_handoffs", "human_queue", "campaign_replies"];
  const now = new Date().toISOString();
  return {
    question: "What needs attention now?",
    selectedPulseSegment: segment,
    lastUpdatedAt: now,
    pulse: {
      activeSegment: segment,
      segments: segmentKeys.map((key) => ({
        key,
        label: commandCenterSegmentLabel(key),
        count: 0,
        intensity: key === segment ? 12 : 8,
        severity: "quiet",
        active: key === segment
      }))
    },
    priorityQueue: {
      activeFilter: segment,
      selectedPriorityItemId: null,
      totalCount: 0,
      items: []
    },
    context: {
      activeSegment: segment,
      selectedPriorityItemId: null,
      default: null,
      items: []
    },
    secondarySignals: [],
    timeline: { events: [] }
  };
}

function renderDashboardFallback(message = "Command Center data is not available yet.") {
  state.dashboardLoaded = true;
  state.humanActionQueue = [];
  state.orderPipeline = {};
  state.leads = state.leads || [];
  state.commandCenter = emptyCommandCenterData();
  renderLeadCards();
  renderChatList();
  renderHumanActionQueue();
  renderOverview({ ...emptyOverviewData(), notice: message });
  setConnectionStatus("error", message);
}

function renderCompanyContextMissing() {
  state.dashboardLoaded = true;
  state.overviewLoaded = true;
  state.latestOverview = emptyOverviewData();
  state.commandCenter = emptyCommandCenterData();
  state.humanActionQueue = [];
  state.orderPipeline = {};
  state.leads = [];
  setText("companyBrandTitle", "Company context missing");
  setText("dashboardHeroTitle", COMPANY_CONTEXT_MISSING_MESSAGE);
  setText("dashboardHeroSummary", "Your account is not assigned to a company workspace.");
  $("#overviewSkeleton")?.classList.add("hidden");
  $("#overviewContent")?.classList.remove("hidden");
  renderLeadCards();
  renderChatList();
  renderHumanActionQueue();
  renderOverview(emptyOverviewData());
  setText("dashboardHeroTitle", COMPANY_CONTEXT_MISSING_MESSAGE);
  setText("dashboardHeroSummary", "Your account is not assigned to a company workspace.");
  setConnectionStatus("error", COMPANY_CONTEXT_MISSING_MESSAGE);
}

function applyDashboardSnapshot(data = emptyOverviewData(), commandCenter = emptyCommandCenterData()) {
  const recentLeads = data.recentLeads || data.recentConversations || [];
  data.recentLeads = recentLeads;
  state.dashboardLoaded = true;
  state.commandCenter = commandCenter || emptyCommandCenterData();
  state.humanActionQueue = data.humanActionQueue || data.items || [];
  state.orderPipeline = data.orderPipeline || data.pipeline || {};
  state.leads = state.leads.length ? mergeLeads(state.leads, recentLeads) : recentLeads;
  renderLeadCards();
  renderChatList();
  renderHumanActionQueue();
  renderOverview(data);
}

async function loadCommandCenter(segment = state.selectedPulseSegment) {
  setCommandCenterLoading(true);
  try {
    const data = await commandCenterApi(segment);
    renderCommandCenter(data);
    return data;
  } finally {
    setCommandCenterLoading(false);
    renderCommandCenterFreshness();
  }
}

function refreshCommandCenterSilently() {
  if (state.currentView !== "overview" || state.isLoadingCommandCenter) return;
  loadCommandCenter(state.selectedPulseSegment).catch((error) => {
    logDashboardError("Command Center refresh failed", error);
  });
}

function focusHighestPriorityItem() {
  const item = state.commandCenter?.priorityQueue?.items?.[0];
  if (!item) {
    showNotice("No attention item is currently waiting.");
    return;
  }
  state.selectedPriorityItemId = item.id;
  renderPriorityQueue();
  renderContextSurface();
  [...document.querySelectorAll("[data-priority-item]")]
    .find((row) => row.dataset.priorityItem === item.id)
    ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function activatePriorityItem(item) {
  if (!item) return;
  const actionLabel = item.recommendedAction || "Review";

  if (item.orderId) {
    if (!featureEnabledForView("orders")) {
      showNotice("Feature disabled by admin.", true);
      return;
    }
    switchView("orders");
    showNotice(`${actionLabel}: ${item.title}`);
    return;
  }

  if (item.workflowId) {
    if (!featureEnabledForView("flows")) {
      showNotice("Feature disabled by admin.", true);
      return;
    }
    switchView("flows");
    showNotice(`${actionLabel}: ${item.title}`);
    return;
  }

  if (item.campaignId) {
    if (!featureEnabledForView("campaigns")) {
      showNotice("Feature disabled by admin.", true);
      return;
    }
    switchView("campaigns");
    showNotice(`${actionLabel}: ${item.title}`);
    return;
  }

  if (item.segmentKey === "campaign_replies") {
    const targetView = item.module === "Broadcasts" ? "broadcasts" : "campaigns";
    if (!featureEnabledForView(targetView)) {
      showNotice("Feature disabled by admin.", true);
      return;
    }
    switchView(targetView);
    showNotice(`${actionLabel}: ${item.title}`);
    return;
  }

  if (item.segmentKey === "human_queue") {
    if (!featureEnabledForView("human")) {
      showNotice("Feature disabled by admin.", true);
      return;
    }
    switchView("human");
    showNotice(`${actionLabel}: ${item.title}`);
    return;
  }

  if (item.module === "Broadcasts") {
    if (!featureEnabledForView("broadcasts")) {
      showNotice("Feature disabled by admin.", true);
      return;
    }
    switchView("broadcasts");
    showNotice(`${actionLabel}: ${item.title}`);
    return;
  }

  if (item.leadId) {
    if (!featureEnabledForView("chats")) {
      showNotice("Feature disabled by admin.", true);
      return;
    }
    openLeadChat(item.leadId).catch((error) => {
      logDashboardError("Priority queue action failed", error, { leadId: item.leadId });
      showNotice("Could not open this priority item yet.", true);
    });
    return;
  }

  showNotice(`${actionLabel}: ${item.title}`);
}

function renderLeadCards() {
  const leads = getFilteredLeads(false);
  const filterName = state.temperatureFilter ? pretty(state.temperatureFilter) : "all";
  setText("leadFilterSummary", `${leads.length} ${filterName} lead${leads.length === 1 ? "" : "s"} in view`);

  const list = $("#leadList");
  if (!list) return;

  renderKeyedChildren(
    list,
    leads,
    (lead) => lead.id,
    (lead) => {
      const temperature = leadTemperature(lead);
      return `
              <article class="lead-card ${state.selectedLeadId === lead.id ? "active" : ""}" data-lead-card="${lead.id}">
                <div class="lead-card-top">
                  <span class="lead-avatar">${escapeHtml(lead.name).slice(0, 1).toUpperCase()}</span>
                  <div>
                    <strong>${escapeHtml(lead.name)}</strong>
                    <small>${escapeHtml(lead.phone || "No phone")} - ${escapeHtml(lead.source || "WhatsApp")}</small>
                  </div>
                  <span class="tag ${temperature.toLowerCase()}">${pretty(temperature)}</span>
                </div>
                <div class="score-row">
                  <span>Lead score</span>
                  <div class="score-track"><i style="width:${scoreForLead(lead)}%"></i></div>
                  <strong>${scoreForLead(lead)}</strong>
                </div>
                <p>${escapeHtml(chatPreviewText(lead.lastMessage || lead.aiInsight || lead.temperatureBasis || "No AI insight captured yet"))}</p>
                <div class="lead-card-meta">
                  <span><i data-lucide="message-circle"></i>${lead.messageCount || 0} messages</span>
                  <span><i data-lucide="clock-3"></i>${relativeTime(lead.lastMessageAt || lead.updatedAt)}</span>
                  <span><i data-lucide="radio"></i>${escapeHtml(lead.source || "WhatsApp")}</span>
                </div>
                <div class="lead-card-actions">
                  <span>${escapeHtml(lead.temperatureBasis || `${pretty(temperature)} by message count`)}</span>
                  <button class="ghost-action" type="button" data-open-chat="${lead.id}">
                    <i data-lucide="messages-square"></i>
                    Open chat
                  </button>
                </div>
              </article>
            `;
    },
    emptyState("No leads match this view", "Adjust search, clear filters, or import a new Sheet segment.")
  );

  bindDelegatedClick(list, "leadCardSelect", "[data-lead-card]", (card, event) => {
    if (event.target.closest("[data-open-chat]")) return;
    loadConversation(card.dataset.leadCard);
  });
  bindDelegatedClick(list, "leadOpenChat", "[data-open-chat]", (button) => openLeadChat(button.dataset.openChat));

  refreshIcons();
}

function renderChatList() {
  const list = $("#chatConversationList");
  if (!list) return;
  const leads = getFilteredLeads(true).filter((lead) => {
    if (state.chatTemperatureFilter && leadTemperature(lead) !== state.chatTemperatureFilter) return false;
    if (state.chatFilter === "unread") return Number(lead.unreadCount || 0) > 0;
    if (state.chatFilter === "human") return isHumanQueueLead(lead);
    if (state.chatFilter === "orders") return Boolean(lead.orderSummary || lead.orderStatus || lead.orderId);
    if (state.chatFilter === "campaign") return /campaign|broadcast|ad/i.test(`${lead.source || ""} ${lead.tags || ""} ${lead.lastMessage || ""}`);
    return true;
  }).sort(
    (a, b) => new Date(b.lastMessageAt || b.updatedAt).getTime() - new Date(a.lastMessageAt || a.updatedAt).getTime()
  );
  document.querySelectorAll("[data-chat-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.chatFilter === state.chatFilter);
  });
  document.querySelectorAll("[data-chat-temperature]").forEach((button) => {
    button.classList.toggle("active", (button.dataset.chatTemperature || "") === state.chatTemperatureFilter);
  });

  renderKeyedChildren(
    list,
    leads,
    (lead) => lead.id,
    (lead) => {
      const unreadCount = Number(lead.unreadCount || 0);
      const temperature = leadTemperature(lead);
      return `
            <button class="chat-list-row whatsapp-row ${state.selectedLeadId === lead.id ? "active" : ""}" data-chat-lead="${lead.id}">
              <span class="lead-avatar">${escapeHtml(lead.name).slice(0, 1).toUpperCase()}</span>
              <span class="chat-list-main">
                <span class="chat-list-top">
                  <strong>${escapeHtml(lead.name)}</strong>
                  <span class="chat-temp-badge ${temperature.toLowerCase()}">${pretty(temperature)}</span>
                </span>
                <small>${escapeHtml(chatPreviewText(lead.lastMessage))}</small>
              </span>
              <span class="chat-list-meta">
                <time>${relativeTime(lead.lastMessageAt || lead.updatedAt)}</time>
                ${unreadCount > 0 ? `<small class="unread-badge">${unreadBadgeLabel(unreadCount)}</small>` : `<small class="unread-badge empty"></small>`}
              </span>
            </button>
          `;
    },
    emptyState("No chats found", "Try another filter or import leads to start conversations.")
  );

  bindDelegatedClick(list, "chatLeadSelect", "[data-chat-lead]", (button) => loadConversation(button.dataset.chatLead));
}

function renderLeadProfile(lead) {
  const letter = lead?.name ? lead.name.slice(0, 1).toUpperCase() : "--";
  setText("profileAvatar", letter);
  setText("profileName", lead?.name || "Lead profile");
  setText("profilePhone", lead?.phone || "Select a conversation");
  setText("profileScore", lead ? scoreForLead(lead) : "--");
  setText("profileMessages", lead ? lead.messageCount || 0 : "--");
  setText("profileReason", lead?.aiInsight || lead?.temperatureBasis || "Select a lead to see scoring context and next-best action.");
  const profileStatus = $("#profileStatus");
  if (profileStatus) {
    const temperature = lead ? leadTemperature(lead) : "neutral";
    profileStatus.textContent = lead ? pretty(temperature) : "Not selected";
    profileStatus.className = `tag ${temperature.toLowerCase()}`;
  }
  renderHumanAttentionProfile(lead);
  renderOrderSummaryProfile(lead?.orderSummary);
}

function renderHumanAttentionProfile(lead) {
  const card = $("#humanAttentionCard");
  if (!card) return;

  const requiresHuman = Boolean(lead?.humanTakeoverRequired && !lead?.humanResolvedAt);
  setHtmlIfChanged(
    card,
    `
    <span>Requires human: <strong>${requiresHuman ? "Yes" : "No"}</strong></span>
    <span>Priority: <strong>${escapeHtml(lead?.humanPriority ? pretty(lead.humanPriority) : "--")}</strong></span>
    <span>Reason: <strong>${escapeHtml(lead?.humanReason || "--")}</strong></span>
  `
  );

  const button = $("#profileResolveHumanBtn");
  if (button) button.classList.toggle("hidden", !requiresHuman);
}

function renderOrderSummaryProfile(order) {
  const card = $("#orderSummaryCard");
  if (!card) return;

  setHtmlIfChanged(
    card,
    `
    <span>Product: <strong>${escapeHtml(emptyValue(order?.productType))}</strong></span>
    <span>Quantity: <strong>${escapeHtml(emptyValue(order?.quantity))}</strong></span>
    <span>Size: <strong>${escapeHtml(emptyValue(order?.size))}</strong></span>
    <span>Color: <strong>${escapeHtml(emptyValue(order?.color))}</strong></span>
    <span>GSM: <strong>${escapeHtml(emptyValue(order?.gsm))}</strong></span>
    <span>Customization: <strong>${escapeHtml(emptyValue(order?.customization))}</strong></span>
    <span>Location: <strong>${escapeHtml(emptyValue(order?.deliveryLocation))}</strong></span>
    <span>Status: <strong>${escapeHtml(order ? formatOrderStatus(order.status) : "--")}</strong></span>
    <span>Confidence: <strong>${order ? confidenceLabel(order.confidenceScore) : "--"}</strong></span>
  `
  );

  document.querySelectorAll("[data-order-action]").forEach((button) => {
    button.toggleAttribute("disabled", !order?.id);
  });
}

function renderThread(messages, targetId, emptyCopy, options = {}) {
  const thread = document.querySelector(targetId);
  if (!thread) return;
  const shouldStickToBottom = options.forceBottom || isNearBottom(thread);
  const previousScrollTop = thread.scrollTop;
  const orderedMessages = normalizeMessages(messages);
  thread.classList.toggle("empty-state", orderedMessages.length === 0);
  renderKeyedChildren(
    thread,
    orderedMessages,
    (message) => message.id,
    (message) => `
            <div class="bubble ${message.direction.toLowerCase()}">
              <span>${escapeHtml(message.text)}</span>
              <small>${formatDate(message.timestamp)}</small>
            </div>
          `,
    emptyState("No conversation yet", emptyCopy)
  );
  if (shouldStickToBottom) {
    thread.scrollTop = thread.scrollHeight;
    $("#newMessageBtn")?.classList.add("hidden");
  } else {
    thread.scrollTop = previousScrollTop;
    $("#newMessageBtn")?.classList.remove("hidden");
  }
}

function renderConversation(data, options = {}) {
  const messages = normalizeMessages(data.messages);
  const latestMessage = messages.at(-1);
  state.selectedLeadId = data.lead.id;
  state.selectedConversation = { ...data, messages };
  const leadFromList = { ...(state.leads.find((lead) => lead.id === data.lead.id) || {}), ...data.lead };
  const meta = `${pretty(data.lead.status)} - ${data.lead.messageCount} messages - ${pretty(leadTemperature(data.lead))}`;
  state.leads = state.leads.map((lead) =>
    lead.id === data.lead.id
      ? {
          ...lead,
          ...data.lead,
          lastMessage: latestMessage?.text ?? lead.lastMessage,
          lastMessageAt: latestMessage?.timestamp ?? lead.lastMessageAt ?? lead.updatedAt,
          updatedAt: latestMessage?.timestamp ?? lead.updatedAt
        }
      : lead
  );

  setText("chatLeadName", data.lead.name);
  setText("chatLeadMeta", meta);
  $("#chatReplyForm")?.classList.remove("hidden");
  renderThread(messages, "#chatThread", "Send a welcome message to start the WhatsApp thread.", options);
  renderLeadProfile(leadFromList);

  renderChatList();
  renderLeadCards();
  refreshIcons();
}

async function loadOverview() {
  try {
    const [dashboardResult, commandCenterResult] = await Promise.allSettled([
      dashboardApi(),
      commandCenterApi(state.selectedPulseSegment)
    ]);

    if (dashboardResult.status === "rejected") {
      throw dashboardResult.reason;
    }

    const commandCenter = commandCenterResult.status === "fulfilled"
      ? commandCenterResult.value
      : emptyCommandCenterData();

    if (commandCenterResult.status === "rejected") {
      logDashboardError("Command Center live signals failed", commandCenterResult.reason);
      if (!state.overviewLoaded) {
        showNotice("Live attention signals are unavailable. Lead analytics are still loaded.", true);
      }
    }

    applyDashboardSnapshot(dashboardResult.value, commandCenter);
    setConnectionStatus("connected");
  } catch (error) {
    logDashboardError("Overview load failed", error);
    if (!state.overviewLoaded) {
      renderDashboardFallback("Command Center data is still loading. Actions will stay disabled until the server responds.");
    } else {
      setConnectionStatus("error", "Reconnecting...");
    }
    showNotice("Command Center data could not load. Existing data will stay visible while we reconnect.", true);
  }
}

async function loadLeads(options = {}) {
  const updateOverview = options.updateOverview ?? state.currentView === "overview";
  if (!state.dashboardLoaded) {
    await loadOverview();
  }
  const data = await publicApi("/leads");
  state.leads = data.leads || state.leads;
  renderLeadCards();
  renderChatList();
  renderHumanActionQueue();
  if (updateOverview) renderDerivedOverview();
}

async function loadOperationalData() {
  if (!state.dashboardLoaded) {
    await loadOverview();
  }
  const queue = await publicApi("/human-action-queue").catch((error) => {
    logDashboardError("Human queue refresh failed", error);
    return null;
  });
  if (queue) state.humanActionQueue = queue.items || [];
  renderHumanActionQueue();
  renderHumanQueueViews();
  refreshIcons();
}

async function loadOrderData() {
  if (!state.dashboardLoaded) {
    await loadOverview();
  }
  const data = await publicApi("/order-pipeline").catch((error) => {
    logDashboardError("Order pipeline refresh failed", error);
    return null;
  });
  if (data) state.orderPipeline = data.pipeline || {};
  renderOrdersView();
  if (state.latestOverview) renderDerivedOverview();
  refreshIcons();
}

async function loadConversation(leadId, options = {}) {
  try {
    const data = await publicApi(`/leads/${leadId}/conversation`);
    renderConversation(
      {
        ...data,
        messages: normalizeMessages(data.messages)
      },
      options
    );
  } catch (error) {
    logDashboardError("Conversation load failed", error, { leadId });
    setConnectionStatus("error", "Reconnecting...");
    showNotice("Could not refresh this chat yet. Keeping the current conversation visible.", true);
  }
}

async function openLeadChat(leadId) {
  switchView("chats");
  await loadConversation(leadId, { forceBottom: true });
}

async function refreshChatStateForLead(leadId, options = {}) {
  await loadLeads({ updateOverview: false });
  if (state.selectedLeadId === leadId) {
    await loadConversation(leadId, options);
  }
}

function commaList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function csvPreviewRows(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.split(",").map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
}

function renderCsvPreview() {
  const target = $("#csvPreview");
  if (!target) return;
  const rows = csvPreviewRows($("#csvTextInput")?.value || "");
  if (!rows.length) {
    target.classList.add("hidden");
    target.innerHTML = "";
    return;
  }

  const headers = rows[0].map((cell) => cell.toLowerCase().replace(/\s+/g, ""));
  const hasHeader = ["name", "phone"].every((header) => headers.includes(header));
  const phoneIndex = hasHeader ? headers.indexOf("phone") : 1;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const invalidPhones = dataRows.filter((row) => !/^\+?[0-9 ()-]{7,}$/.test(row[phoneIndex] || "")).length;
  const tagText = commaList($("#csvDefaultTags")?.value || "").join(", ") || "No default tags";
  target.classList.remove("hidden");
  target.innerHTML = `
    <strong>Preview: ${dataRows.length} row${dataRows.length === 1 ? "" : "s"}</strong>
    <span>${hasHeader ? "Headers detected: name, phone, tags, source" : "No header row detected. Expected order: name, phone, tags, source."}</span>
    <span>${invalidPhones ? `${invalidPhones} phone value${invalidPhones === 1 ? "" : "s"} need review.` : "Phone numbers look ready."}</span>
    <small>Default tags: ${escapeHtml(tagText)}</small>
  `;
}

function selectedAudienceFromContacts(extra = {}) {
  const leadIds = [...state.selectedContactIds];
  return {
    ...(leadIds.length ? { leadIds } : {}),
    ...(extra.tag ? { tag: extra.tag } : {}),
    ...(extra.source ? { source: extra.source } : {}),
    ...(extra.status ? { status: extra.status } : {}),
    ...(!leadIds.length && state.contactFilters.tag ? { tag: state.contactFilters.tag } : {}),
    ...(!leadIds.length && state.contactFilters.source ? { source: state.contactFilters.source } : {}),
    ...(!leadIds.length && state.contactFilters.status ? { status: state.contactFilters.status } : {})
  };
}

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (["sent", "completed", "read", "delivered", "running"].includes(value)) return "green";
  if (["failed", "cancelled"].includes(value)) return "red";
  if (["scheduled", "queued", "draft", "paused"].includes(value)) return "amber";
  return "neutral";
}

function setupRequiredHtml(details = {}) {
  const missingTables = details.missingTables || [];
  const missingLeadColumns = details.missingLeadColumns || [];
  const missing = [...missingTables, ...missingLeadColumns.map((column) => `Lead.${column}`)];
  return `
    <article class="setup-required-card">
      <span><i data-lucide="database-zap"></i></span>
      <div>
        <strong>Setup Required</strong>
        <p>${escapeHtml(details.message || "Run the automation database migration before using this section.")}</p>
        <small>${missing.length ? `Missing: ${escapeHtml(missing.join(", "))}` : "Automation tables are not ready yet."}</small>
      </div>
    </article>
  `;
}

function renderSetupRequired(targets, error) {
  const details = error?.setupDetails || {};
  targets.forEach((selector) => {
    const target = $(selector);
    if (target) target.innerHTML = setupRequiredHtml(details);
  });
  refreshIcons();
}

function renderSelectOptions(select, values, currentValue, label) {
  if (!select) return;
  select.innerHTML = [`<option value="">${escapeHtml(label)}</option>`, ...values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(pretty(value))}</option>`)].join("");
  select.value = currentValue || "";
}

async function loadSessionAndFeatures() {
  const sessionData = await publicApi("/session");
  state.session = sessionData.session || null;
  if (isAdmin()) {
    const error = new Error("Redirecting to admin panel.");
    error.redirecting = true;
    window.location.replace("/admin");
    throw error;
  }

  if (!state.session?.company?.id) {
    state.features = [];
    state.enabledFeatureKeys = new Set();
    applyFeatureVisibility();
    const error = new Error(COMPANY_CONTEXT_MISSING_MESSAGE);
    error.companyContextMissing = true;
    throw error;
  }

  const featureData = await publicApi("/features/enabled");
  state.features = featureData.features || [];
  try {
    const integrationData = await publicApi("/integrations/status");
    state.integration = integrationData.integration || null;
  } catch (error) {
    logDashboardError("Integration status load failed", error);
    state.integration = null;
  }
  state.enabledFeatureKeys = new Set(state.features.map((feature) => feature.key));
  applyFeatureVisibility();
  applyIntegrationAvailability();
}

function isAdmin() {
  return state.session?.role === "ADMIN";
}

function companyInitials(companyName) {
  return String(companyName || "CRM")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function featureEnabledForView(view) {
  const key = viewFeatureMap[view];
  return isAdmin() || !key || state.enabledFeatureKeys.has(key);
}

function firstAvailableView() {
  return Object.keys(views).find((view) => featureEnabledForView(view)) || "overview";
}

function requestedViewFromLocation() {
  const hashView = window.location.hash.replace("#", "");
  if (views[hashView]) return hashView;

  const pathMap = {
    "/app/dashboard": "overview",
    "/app/inbox": "chats",
    "/app/leads": "leads",
    "/app/ads": "ads",
    "/app/orders": "orders",
    "/app/human-queue": "human",
    "/app/knowledge-base": "settings",
    "/app/settings": "settings"
  };

  return pathMap[window.location.pathname] || "";
}

function applyFeatureVisibility() {
  document.body.dataset.role = state.session?.role || "USER";
  const company = state.session?.company;
  const missingCompanyContext = Boolean(state.session && !isAdmin() && !company?.id);
  const companyName = isAdmin() ? "Platform" : missingCompanyContext ? "Company context missing" : company?.name || "CRM OS";
  const companyMark = companyInitials(companyName);
  setText("companyBrandTitle", companyName);
  setText("dashboardHeroTitle", missingCompanyContext ? COMPANY_CONTEXT_MISSING_MESSAGE : `${companyName} CRM Command Center`);
  if (company?.brandColor) document.documentElement.style.setProperty("--tenant-accent", company.brandColor);
  const initials = (state.session?.email || state.session?.username || companyMark || "AD")
    .split("@")[0]
    .split(/[.\-_]/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  setText("profileInitials", initials || "AD");
  setText("settingsCompanyName", company?.name || "--");
  setText("settingsCompanySlug", company?.slug || "--");
  setText("settingsCompanyWhatsapp", company?.whatsappNumber || "--");
  setText("settingsCompanyTimezone", company?.timezone || "--");
  setText("settingsCompanyMeta", company?.businessType ? `${pretty(company.businessType)} workspace` : "Workspace details from your account.");
  setText("settingsUserName", state.session?.username || state.session?.email || "--");
  setText("settingsAccountEmail", state.session?.username || state.session?.email || "--");
  setText("settingsAccountRole", pretty(state.session?.role || "--"));

  document.querySelectorAll("[data-view]").forEach((button) => {
    if (button.dataset.temperatureTab !== undefined) return;
    const visible = featureEnabledForView(button.dataset.view);
    button.hidden = !visible;
    button.setAttribute("aria-hidden", String(!visible));
  });

  const panel = $("#adminFeaturePanel");
  if (panel) panel.classList.toggle("hidden", !isAdmin());
  renderFeatureToggles();
}

function integrationConnected(key) {
  return Boolean(state.integration?.connected?.[key]);
}

function applyIntegrationAvailability() {
  const whatsAppConnected = integrationConnected("whatsapp");
  const googleSheetsConnected = integrationConnected("googleSheets");
  const metaAdsConnected = integrationConnected("metaAds");

  ["sendSelectedBulkBtn", "sendInitialBtn"].forEach((id) => {
    const button = $(`#${id}`);
    if (!button) return;
    button.disabled = !whatsAppConnected;
    button.title = whatsAppConnected ? "" : "WhatsApp not connected for your company.";
  });
  ["importSheetsContactsBtn", "importLeadsBtn"].forEach((id) => {
    const button = $(`#${id}`);
    if (!button) return;
    button.disabled = !googleSheetsConnected;
    button.title = googleSheetsConnected ? "" : "Google Sheets not connected.";
  });
  state.metaAdsConnected = Boolean(metaAdsConnected || state.ads.connection?.metaAds?.connected);
  renderAds();
}

function renderFeatureToggles() {
  const target = $("#featureToggleList");
  if (!target || !isAdmin()) return;
  target.innerHTML = state.features
    .map((feature) => `
      <article class="feature-toggle ${feature.enabled ? "active" : "inactive"}">
        <div class="feature-toggle-copy">
          <strong>${escapeHtml(feature.label)}</strong>
          <small>${escapeHtml(featureDescriptions[feature.key] || "Controls User panel access for this module.")}</small>
        </div>
        <mark class="${feature.enabled ? "green" : "neutral"}">${feature.enabled ? "Active" : "Inactive"}</mark>
        <button
          class="toggle-switch ${feature.enabled ? "is-on" : "is-off"}"
          type="button"
          role="switch"
          aria-checked="${feature.enabled ? "true" : "false"}"
          data-feature-toggle="${escapeHtml(feature.key)}"
        >
          <span class="toggle-track" aria-hidden="true"><i></i></span>
          <b>${feature.enabled ? "ON" : "OFF"}</b>
        </button>
      </article>
    `)
    .join("");
}

function renderFeatureDisabled(view) {
  const activated = new Set();
  Object.entries(views).forEach(([key, element]) => {
    if (!element || activated.has(element)) return;
    activated.add(element);
    const active = key === view;
    element.classList.toggle("active-view", active);
  });
  const target = views[view];
  if (!target) return;
  target.innerHTML = `
    <section class="panel premium-card feature-disabled-card">
      <p class="eyebrow">Access Control</p>
      <h1>Feature disabled by admin.</h1>
      <span>This module is not available for your user role right now.</span>
    </section>
  `;
}

async function loadContacts() {
  try {
    const query = buildQuery(state.contactFilters);
    const data = await publicApi(`/contacts${query}`);
    state.contacts = data.contacts || [];
    state.contactFacets = data.facets || state.contactFacets;
    renderContacts();
  } catch (error) {
    if (error.setupRequired) {
      state.contacts = [];
      state.bulkJobs = [];
      renderSetupRequired(["#contactsTable", "#bulkJobsList"], error);
      setText("contactTableTitle", "Setup Required");
      return;
    }
    throw error;
  }
}

function renderContacts() {
  setText("contactTableTitle", `${state.contacts.length} audience contact${state.contacts.length === 1 ? "" : "s"}`);
  renderSelectOptions($("#contactTagFilter"), state.contactFacets.tags || [], state.contactFilters.tag, "All tags");
  renderSelectOptions($("#contactStatusFilter"), state.contactFacets.statuses || [], state.contactFilters.status, "All statuses");
  renderSelectOptions($("#contactSourceFilter"), state.contactFacets.sources || [], state.contactFilters.source, "All sources");

  const table = $("#contactsTable");
  if (!table) return;
  if (!state.contacts.length) {
    table.innerHTML = emptyState("No audience yet.", "Add contacts, import a CSV, or sync Google Sheets before sending a broadcast.");
    return;
  }

  table.innerHTML = `
    <div class="data-row data-head">
      <span></span><span>Name</span><span>Mobile Number</span><span>Tags</span><span>Source</span><span>Status</span><span>Last touch</span><span>Action</span>
    </div>
    ${state.contacts
      .map((contact) => `
        <div class="data-row contact-row" data-contact-id="${escapeHtml(contact.id)}">
          <span><input type="checkbox" data-contact-check="${escapeHtml(contact.id)}" ${state.selectedContactIds.has(contact.id) ? "checked" : ""} /></span>
          <span><strong>${escapeHtml(contact.name || "Unknown")}</strong></span>
          <span>${escapeHtml(contact.phone)}</span>
          <span class="tag-list">${(contact.tags || []).map((tag) => `<b>${escapeHtml(tag)}</b>`).join("") || "--"}</span>
          <span>${escapeHtml(contact.source || "--")}</span>
          <span><mark class="${statusTone(contact.status)}">${escapeHtml(pretty(contact.status))}</mark></span>
          <span>${contact.lastContacted ? formatDate(contact.lastContacted) : "--"}</span>
          <span><button class="ghost-action" type="button" data-open-chat="${escapeHtml(contact.id)}"><i data-lucide="messages-square"></i>Chat</button></span>
        </div>
      `)
      .join("")}
  `;

  bindDelegatedClick(table, "contactCheck", "[data-contact-check]", (checkbox) => {
    if (checkbox.checked) state.selectedContactIds.add(checkbox.dataset.contactCheck);
    else state.selectedContactIds.delete(checkbox.dataset.contactCheck);
    renderContacts();
    updateBroadcastPreview();
  });
  bindDelegatedClick(table, "contactChat", "[data-open-chat]", (button) => {
    if (!featureEnabledForView("chats")) {
      showNotice("Feature disabled by admin.", true);
      return;
    }
    openLeadChat(button.dataset.openChat);
  });
  refreshIcons();
}

async function addContactFromPrompt() {
  const name = window.prompt("Contact name");
  if (!name) return;
  const phone = window.prompt("WhatsApp phone number");
  if (!phone) return;
  const tags = commaList(window.prompt("Tags separated by commas") || "");
  await publicApi("/contacts", {
    method: "POST",
    body: JSON.stringify({ name, phone, tags, source: "manual" })
  });
  showNotice("Contact saved.");
  await loadContacts();
}

async function loadBulkJobs() {
  try {
    const data = await publicApi("/bulk-messages");
    state.bulkJobs = data.jobs || [];
    renderBulkJobs();
  } catch (error) {
    if (error.setupRequired) {
      state.bulkJobs = [];
      renderSetupRequired(["#bulkJobsList"], error);
      return;
    }
    throw error;
  }
}

function renderBulkJobs() {
  const target = $("#bulkJobsList");
  if (!target) return;
  const totals = state.bulkJobs.reduce(
    (result, job) => ({
      sent: result.sent + Number(job.sentCount || 0),
      failed: result.failed + Number(job.failedCount || 0),
      queued: result.queued + Number(job.queuedCount || 0),
      delivered: result.delivered + (job.recipients || []).filter((recipient) => String(recipient.status).toUpperCase() === "DELIVERED").length,
      read: result.read + (job.recipients || []).filter((recipient) => String(recipient.status).toUpperCase() === "READ").length
    }),
    { sent: 0, failed: 0, queued: 0, delivered: 0, read: 0 }
  );
  setText("broadcastSentCount", totals.sent);
  setText("broadcastFailedCount", totals.failed);
  setText("broadcastQueuedCount", totals.queued);
  setText("broadcastDeliveredCount", totals.delivered);
  setText("broadcastReadCount", totals.read);
  renderKeyedChildren(
    target,
    state.bulkJobs,
    (job) => job.id,
    (job) => `
      <article class="bulk-job-card">
        <div class="bulk-job-main">
          <div>
            <strong>${escapeHtml(job.name)}</strong>
            <small>${escapeHtml(job.templateName)} / ${formatDate(job.createdAt)}</small>
          </div>
          <mark class="${statusTone(job.status)}">${escapeHtml(pretty(job.status))}</mark>
        </div>
        <div class="bulk-job-meta">
          <span>${job.sentCount || 0} sent</span>
          <span>${job.failedCount || 0} failed</span>
          <span>${job.queuedCount || 0} queued</span>
        </div>
        <div class="bulk-progress" aria-label="Broadcast progress">
          <i style="width:${Math.round(((job.sentCount || 0) + (job.failedCount || 0)) / Math.max(1, job.totalCount || 1) * 100)}%"></i>
        </div>
        <div class="bulk-job-footer">
          <small>${escapeHtml(relativeTime(job.createdAt))}</small>
          <button class="ghost-action" type="button" data-bulk-detail="${escapeHtml(job.id)}"><i data-lucide="list-checks"></i>View details</button>
        </div>
      </article>
    `,
    emptyState("No broadcasts yet.", "Queue an approved template send to see delivery progress.")
  );
  refreshIcons();
  updateBroadcastPreview();
  renderReports();
}

function updateBroadcastPreview() {
  const templateName = $("#bulkTemplateName")?.value.trim();
  const audienceCount = state.selectedContactIds.size || state.contacts.length;
  const content = $("#templateContentInput")?.value.trim();
  setText(
    "broadcastPreviewText",
    templateName
      ? `${audienceCount} selected/filtered contact${audienceCount === 1 ? "" : "s"} will receive template ${templateName}.${content ? ` Preview: ${content}` : ""}`
      : "Select a template and audience to preview this WhatsApp broadcast."
  );
}

async function loadCampaigns() {
  try {
    const data = await publicApi("/campaigns");
    state.campaigns = data.campaigns || [];
    renderCampaigns();
  } catch (error) {
    if (error.setupRequired) {
      state.campaigns = [];
      renderSetupRequired(["#campaignsTable", "#campaignDetail"], error);
      setText("campaignDetailTitle", "Setup Required");
      return;
    }
    throw error;
  }
}

function renderCampaigns() {
  const table = $("#campaignsTable");
  if (!table) return;
  if (!state.campaigns.length) {
    table.innerHTML = emptyState("No campaigns yet.", "Plan a scheduled or immediate WhatsApp template campaign.");
    setText("campaignDetailTitle", "Campaign readiness");
    const detail = $("#campaignDetail");
    if (detail) {
      detail.classList.add("empty-state");
      detail.innerHTML = `
        <div class="campaign-guide-grid">
          <span><i data-lucide="users"></i><strong>Choose audience</strong><small>All contacts, tags, CSV, Google Sheets, or selected contacts.</small></span>
          <span><i data-lucide="badge-check"></i><strong>Select template</strong><small>Use an approved WhatsApp template for outbound campaign sends.</small></span>
          <span><i data-lucide="calendar-clock"></i><strong>Run or schedule</strong><small>Create a server-side campaign job that continues when the dashboard is closed.</small></span>
        </div>
      `;
      refreshIcons();
    }
    renderReports();
    return;
  }

  table.innerHTML = `
    <div class="data-row campaign-head">
      <span>Campaign</span><span>Audience</span><span>Template</span><span>Status</span><span>Scheduled</span><span>Created</span><span>Replies</span><span>Actions</span>
    </div>
    ${state.campaigns.map((campaign) => `
      <div class="data-row campaign-row" data-campaign-id="${escapeHtml(campaign.id)}">
        <span><strong>${escapeHtml(campaign.name)}</strong></span>
        <span>${escapeHtml(campaign.audienceLabel || `${campaign.audienceCount || 0} contacts`)}</span>
        <span>${escapeHtml(campaign.templateName || "--")}</span>
        <span><mark class="${statusTone(campaign.status)}">${escapeHtml(pretty(campaign.status))}</mark></span>
        <span>${campaign.scheduledAt ? formatDate(campaign.scheduledAt) : "--"}</span>
        <span>${formatDate(campaign.createdAt)}</span>
        <span>${escapeHtml(campaign.replies || 0)}</span>
        <span class="row-actions">
          <button class="secondary-button icon-button" type="button" data-view-campaign="${escapeHtml(campaign.id)}" aria-label="View campaign"><i data-lucide="eye"></i></button>
          ${String(campaign.status).toUpperCase() === "PAUSED"
            ? `<button class="secondary-button icon-button" type="button" data-resume-campaign="${escapeHtml(campaign.id)}" aria-label="Resume campaign"><i data-lucide="play"></i></button>`
            : `<button class="secondary-button icon-button" type="button" data-pause-campaign="${escapeHtml(campaign.id)}" aria-label="Pause campaign"><i data-lucide="pause"></i></button>`}
          <button class="danger-button icon-button" type="button" data-delete-campaign="${escapeHtml(campaign.id)}" aria-label="Delete campaign"><i data-lucide="trash-2"></i></button>
        </span>
      </div>
    `).join("")}
  `;

  bindDelegatedClick(table, "campaignDetail", "[data-campaign-id]", (button, event) => {
    if (event.target.closest("[data-pause-campaign], [data-resume-campaign], [data-delete-campaign]")) return;
    loadCampaignDetail(button.dataset.campaignId).catch((error) => showNotice(error.message, true));
  });
  bindDelegatedClick(table, "campaignPause", "[data-pause-campaign]", async (button) => {
    await publicApi(`/campaigns/${button.dataset.pauseCampaign}/pause`, { method: "POST" });
    showNotice("Campaign paused.");
    await loadCampaigns();
  });
  bindDelegatedClick(table, "campaignResume", "[data-resume-campaign]", async (button) => {
    await publicApi(`/campaigns/${button.dataset.resumeCampaign}/resume`, { method: "POST" });
    showNotice("Campaign resumed.");
    await loadCampaigns();
  });
  bindDelegatedClick(table, "campaignDelete", "[data-delete-campaign]", async (button) => {
    if (!window.confirm("Delete this campaign?")) return;
    await publicApi(`/campaigns/${button.dataset.deleteCampaign}`, { method: "DELETE" });
    showNotice("Campaign deleted.");
    await loadCampaigns();
  });

  if (!state.selectedCampaignId || !state.campaigns.some((campaign) => campaign.id === state.selectedCampaignId)) {
    loadCampaignDetail(state.campaigns[0].id).catch((error) => showNotice(error.message, true));
  }
  renderReports();
}

async function loadCampaignDetail(campaignId) {
  const data = await publicApi(`/campaigns/${campaignId}`);
  state.selectedCampaignId = campaignId;
  const campaign = data.campaign;
  setText("campaignDetailTitle", campaign.name);
  const target = $("#campaignDetail");
  if (!target) return;
  target.classList.remove("empty-state");
  target.innerHTML = `
    <div class="metric-mini-grid">
      <span><strong>${campaign.audienceCount}</strong><small>Audience</small></span>
      <span><strong>${campaign.sent}</strong><small>Sent</small></span>
      <span><strong>${campaign.failed}</strong><small>Failed</small></span>
      <span><strong>${campaign.replies}</strong><small>Replies</small></span>
    </div>
    <div class="campaign-detail-grid">
      <div class="message-preview"><strong>Template preview</strong><p>${escapeHtml(campaign.messagePreview || `[Template: ${campaign.templateName}]`)}</p></div>
      <div class="message-preview"><strong>Reply summary</strong><p>${campaign.replies ? `${campaign.replies} contacts have replied from this campaign.` : "Replies generated from this campaign will appear here."}</p></div>
    </div>
    <div class="automation-list compact">
      ${(campaign.recipients || []).map((recipient) => `
        <article class="automation-row">
          <div><strong>${escapeHtml(recipient.name)}</strong><small>${escapeHtml(recipient.phone)}</small></div>
          <div class="row-actions">
            <mark class="${statusTone(recipient.status)}">${escapeHtml(pretty(recipient.status))}</mark>
            ${recipient.errorMessage ? `<small>${escapeHtml(recipient.errorMessage)}</small>` : ""}
          </div>
        </article>
      `).join("") || emptyState("No audience recipients yet.", "Recipients are created when the campaign is saved.")}
    </div>
  `;
  refreshIcons();
}

async function loadAds() {
  try {
    const data = await publicApi("/app/ads");
    state.ads.connection = data.connection || null;
    state.ads.metrics = data.metrics || {};
    state.ads.campaigns = data.campaigns || [];
    state.ads.adsManagerUrl = data.connection?.adsManagerUrl || state.ads.adsManagerUrl;
    state.metaAdsConnected = Boolean(data.connection?.metaAds?.connected);
    renderAds();
  } catch (error) {
    if (error.setupRequired) {
      state.ads.campaigns = [];
      renderAdPreview();
      renderSetupRequired(["#adCampaignList"], error);
      return;
    }
    throw error;
  }
}

function connectionLabel(connected, readyText = "Connected", missingText = "Not Connected") {
  return connected ? readyText : missingText;
}

function moneyLabel(value) {
  if (value === null || value === undefined || value === "") return "Coming soon";
  return String(value);
}

function campaignBudgetLabel(campaign) {
  const budget = campaign?.budgetConfig || {};
  if (budget.dailyBudget) return `${budget.currency || ""} ${budget.dailyBudget}/day`.trim();
  if (budget.lifetimeBudget) return `${budget.currency || ""} ${budget.lifetimeBudget} lifetime`.trim();
  return "Budget not set";
}

function currentAdObjective() {
  return document.querySelector("input[name='adObjective']:checked")?.value || "CLICK_TO_WHATSAPP";
}

function collectAdPayload(status = "DRAFT") {
  const creativeConfig = {
    adName: $("#adName")?.value.trim() || "",
    primaryText: $("#adPrimaryText")?.value.trim() || "",
    headline: $("#adHeadline")?.value.trim() || "",
    description: $("#adDescription")?.value.trim() || "",
    cta: $("#adCta")?.value.trim() || "Send WhatsApp Message",
    utmParams: $("#adUtm")?.value.trim() || ""
  };
  const audienceConfig = {
    type: $("#adAudienceType")?.value || "manual",
    manualTargeting: $("#adAudienceText")?.value.trim() || "",
    csvPlaceholder: Boolean($("#adAudienceCsv")?.files?.length)
  };
  const budgetConfig = {
    dailyBudget: $("#adDailyBudget")?.value ? Number($("#adDailyBudget").value) : null,
    lifetimeBudget: $("#adLifetimeBudget")?.value ? Number($("#adLifetimeBudget").value) : null,
    startDate: $("#adStartDate")?.value || null,
    endDate: $("#adEndDate")?.value || null,
    timezone: $("#adTimezone")?.value.trim() || ""
  };
  const automationConfig = {
    whatsappNumber: $("#adWhatsappNumber")?.value.trim() || "",
    phoneNumberId: $("#adPhoneNumberId")?.value.trim() || "",
    welcomeText: $("#adWelcomeText")?.value.trim() || "",
    tagNewLeadAsAdLead: Boolean($("#adTagLead")?.checked),
    startAiWorkflow: Boolean($("#adStartAiWorkflow")?.checked),
    assignAgent: $("#adAssignAgent")?.value.trim() || "",
    addToLeadManagement: Boolean($("#adAddToLeadManagement")?.checked),
    humanQueueHighIntent: Boolean($("#adHumanQueueHighIntent")?.checked),
    updateGoogleSheet: Boolean($("#adUpdateSheet")?.checked)
  };

  return {
    name: creativeConfig.adName || "Untitled Click-to-WhatsApp Ad",
    objective: currentAdObjective(),
    platform: $("#adPlatform")?.value || "FACEBOOK_INSTAGRAM",
    status,
    creativeConfig,
    audienceConfig,
    budgetConfig,
    automationConfig,
    trackingConfig: {
      utmParams: creativeConfig.utmParams,
      source: "CRM_OS_ADS"
    }
  };
}

function setAdWizardStep(step) {
  state.ads.wizardStep = Math.min(8, Math.max(1, Number(step) || 1));
  document.querySelectorAll("[data-ad-step]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.adStep) === state.ads.wizardStep);
  });
  document.querySelectorAll("[data-ad-step-panel]").forEach((panel) => {
    panel.classList.toggle("active", Number(panel.dataset.adStepPanel) === state.ads.wizardStep);
  });
  $("#prevAdStepBtn")?.toggleAttribute("disabled", state.ads.wizardStep === 1);
  $("#nextAdStepBtn")?.toggleAttribute("disabled", state.ads.wizardStep === 8);
  renderAdPreview();
}

function fillAdForm(campaign) {
  state.ads.editingId = campaign?.id || null;
  const creative = campaign?.creativeConfig || {};
  const audience = campaign?.audienceConfig || {};
  const budget = campaign?.budgetConfig || {};
  const automation = campaign?.automationConfig || {};
  const objectiveInput = document.querySelector(`input[name='adObjective'][value='${campaign?.objective || "CLICK_TO_WHATSAPP"}']`);
  if (objectiveInput) objectiveInput.checked = true;
  if ($("#adPlatform")) $("#adPlatform").value = campaign?.platform || "FACEBOOK_INSTAGRAM";
  if ($("#adWhatsappNumber")) $("#adWhatsappNumber").value = automation.whatsappNumber || "";
  if ($("#adPhoneNumberId")) $("#adPhoneNumberId").value = automation.phoneNumberId || "";
  if ($("#adWelcomeText")) $("#adWelcomeText").value = automation.welcomeText || "";
  if ($("#adAudienceType")) $("#adAudienceType").value = audience.type || "manual";
  if ($("#adAudienceText")) $("#adAudienceText").value = audience.manualTargeting || "";
  if ($("#adName")) $("#adName").value = creative.adName || campaign?.name || "";
  if ($("#adPrimaryText")) $("#adPrimaryText").value = creative.primaryText || "";
  if ($("#adHeadline")) $("#adHeadline").value = creative.headline || "";
  if ($("#adDescription")) $("#adDescription").value = creative.description || "";
  if ($("#adCta")) $("#adCta").value = creative.cta || "Send WhatsApp Message";
  if ($("#adUtm")) $("#adUtm").value = creative.utmParams || "";
  if ($("#adDailyBudget")) $("#adDailyBudget").value = budget.dailyBudget || "";
  if ($("#adLifetimeBudget")) $("#adLifetimeBudget").value = budget.lifetimeBudget || "";
  if ($("#adStartDate")) $("#adStartDate").value = budget.startDate || "";
  if ($("#adEndDate")) $("#adEndDate").value = budget.endDate || "";
  if ($("#adTimezone")) $("#adTimezone").value = budget.timezone || "";
  if ($("#adTagLead")) $("#adTagLead").checked = automation.tagNewLeadAsAdLead !== false;
  if ($("#adStartAiWorkflow")) $("#adStartAiWorkflow").checked = Boolean(automation.startAiWorkflow);
  if ($("#adAssignAgent")) $("#adAssignAgent").value = automation.assignAgent || "";
  if ($("#adAddToLeadManagement")) $("#adAddToLeadManagement").checked = automation.addToLeadManagement !== false;
  if ($("#adHumanQueueHighIntent")) $("#adHumanQueueHighIntent").checked = automation.humanQueueHighIntent !== false;
  if ($("#adUpdateSheet")) $("#adUpdateSheet").checked = Boolean(automation.updateGoogleSheet);
  setAdWizardStep(1);
  $("#adWizard")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderAds() {
  const connection = state.ads.connection || {};
  const meta = connection.metaAds || {};
  const whatsApp = connection.whatsApp || {};
  state.metaAdsConnected = Boolean(meta.connected);
  setHtmlIfChanged($("#metaAdsStatus"), `<i data-lucide="${state.metaAdsConnected ? "plug-zap" : "plug"}"></i>${state.metaAdsConnected ? "Meta Ads connected" : "Meta Ads not connected"}`);
  $("#metaAdsStatus")?.classList.toggle("connected", state.metaAdsConnected);
  setText(
    "metaAdsStatusText",
    state.metaAdsConnected
      ? "Meta Ads is connected. Click-to-WhatsApp ads can be launched directly when WhatsApp Cloud API is also connected."
      : "Connect Meta Ads in Admin Integrations to publish ads directly. You can still create drafts and map manually launched ads."
  );

  const connectionGrid = $("#adsConnectionGrid");
  if (connectionGrid) {
    connectionGrid.innerHTML = [
      ["Meta Ads", connectionLabel(meta.connected), meta.connected],
      ["WhatsApp Cloud API", connectionLabel(whatsApp.connected), whatsApp.connected],
      ["Facebook Page", connectionLabel(connection.facebookPage?.connected, "Connected", "Missing"), connection.facebookPage?.connected],
      ["Ad Account", connectionLabel(connection.adAccount?.connected, "Connected", "Missing"), connection.adAccount?.connected]
    ].map(([label, value, ok]) => `<span class="${ok ? "ready" : "missing"}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></span>`).join("");
  }

  const metrics = state.ads.metrics || {};
  const metricRows = [
    ["Active Ads", metrics.activeAds || 0],
    ["Draft Ads", metrics.draftAds || 0],
    ["Conversations Started", metrics.conversationsStarted || 0],
    ["Leads Generated", metrics.leadsGenerated || 0],
    ["Hot Leads", metrics.hotLeads || 0],
    ["Orders Generated", metrics.ordersGenerated || 0],
    ["Human Queue from Ads", metrics.humanQueueFromAds || 0],
    ["Spend", moneyLabel(metrics.spend)],
    ["Cost per Conversation", moneyLabel(metrics.costPerConversation)]
  ];
  setHtmlIfChanged($("#adsMetrics"), metricRows.map(([label, value]) => `<span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></span>`).join(""));

  document.querySelectorAll("[data-ad-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adFilter === state.ads.filter);
  });

  const list = $("#adCampaignList");
  if (list) {
    const rows = state.ads.campaigns.filter((campaign) => state.ads.filter === "ALL" || campaign.status === state.ads.filter);
    list.innerHTML = rows.length ? rows.map((campaign) => {
      const stats = campaign.stats || {};
      return `
        <article class="ad-campaign-card" data-ad-id="${escapeHtml(campaign.id)}">
          <div class="ad-campaign-main">
            <span class="integration-provider-icon"><i data-lucide="megaphone"></i></span>
            <div>
              <strong>${escapeHtml(campaign.name)}</strong>
              <small>${escapeHtml(pretty(campaign.objective))} - ${escapeHtml(pretty(campaign.platform))}</small>
            </div>
            <mark class="${statusTone(campaign.status)}">${escapeHtml(pretty(campaign.status))}</mark>
          </div>
          <div class="ad-campaign-facts">
            <span><small>Budget</small><b>${escapeHtml(campaignBudgetLabel(campaign))}</b></span>
            <span><small>Start date</small><b>${escapeHtml(campaign.budgetConfig?.startDate || "--")}</b></span>
            <span><small>End date</small><b>${escapeHtml(campaign.budgetConfig?.endDate || "--")}</b></span>
            <span><small>Meta Ad ID</small><b>${escapeHtml(campaign.metaAdId || "--")}</b></span>
            <span><small>Conversations</small><b>${escapeHtml(stats.conversationsStarted || 0)}</b></span>
            <span><small>Leads</small><b>${escapeHtml(stats.leadsGenerated || 0)}</b></span>
            <span><small>Orders</small><b>${escapeHtml(stats.ordersGenerated || 0)}</b></span>
          </div>
          ${campaign.errorMessage ? `<p class="ad-error">${escapeHtml(campaign.errorMessage)}</p>` : ""}
          <div class="row-actions ads-row-actions">
            <button class="secondary-button" type="button" data-view-ad="${escapeHtml(campaign.id)}"><i data-lucide="eye"></i>View</button>
            <button class="secondary-button" type="button" data-edit-ad="${escapeHtml(campaign.id)}"><i data-lucide="pencil"></i>Edit</button>
            <button class="primary-button" type="button" data-launch-ad="${escapeHtml(campaign.id)}"><i data-lucide="rocket"></i>Launch</button>
            <button class="secondary-button" type="button" data-manual-ad="${escapeHtml(campaign.id)}"><i data-lucide="link"></i>Mark Manually Launched</button>
            ${campaign.status === "PAUSED" ? `<button class="secondary-button" type="button" data-resume-ad="${escapeHtml(campaign.id)}"><i data-lucide="play"></i>Resume</button>` : `<button class="secondary-button" type="button" data-pause-ad="${escapeHtml(campaign.id)}"><i data-lucide="pause"></i>Pause</button>`}
            <button class="secondary-button" type="button" data-open-ad-manager="${escapeHtml(campaign.id)}"><i data-lucide="external-link"></i>Open Meta Ads Manager</button>
          </div>
        </article>
      `;
    }).join("") : emptyState("No ads yet.", "Create a Click-to-WhatsApp ad draft or map a manually launched Meta ad.");

    bindDelegatedClick(list, "adView", "[data-view-ad]", async (button) => {
      const campaign = state.ads.campaigns.find((item) => item.id === button.dataset.viewAd);
      if (!campaign) return;
      fillAdForm(campaign);
      setAdWizardStep(8);
    });
    bindDelegatedClick(list, "adEdit", "[data-edit-ad]", (button) => {
      const campaign = state.ads.campaigns.find((item) => item.id === button.dataset.editAd);
      if (campaign) fillAdForm(campaign);
    });
    bindDelegatedClick(list, "adLaunch", "[data-launch-ad]", async (button) => {
      if (!window.confirm("Launch this Click-to-WhatsApp ad through Meta Ads API?")) return;
      try {
        await publicApi(`/app/ads/${button.dataset.launchAd}/launch`, { method: "POST" });
        showNotice("Ad launch requested.");
        await loadAds();
      } catch (error) {
        showNotice(error.message, true);
        await loadAds();
      }
    });
    bindDelegatedClick(list, "adManual", "[data-manual-ad]", async (button) => {
      const metaAdId = window.prompt("Paste Meta Ad ID");
      if (!metaAdId) return;
      const metaCampaignId = window.prompt("Optional Meta Campaign ID") || "";
      const metaAdSetId = window.prompt("Optional Meta Ad Set ID") || "";
      const launchUrl = window.prompt("Optional Meta Ads Manager URL") || "";
      await publicApi(`/app/ads/${button.dataset.manualAd}/mark-manually-launched`, {
        method: "POST",
        body: JSON.stringify({ metaAdId, metaCampaignId, metaAdSetId, launchUrl })
      });
      showNotice("Meta Ad ID mapped for tracking.");
      await loadAds();
    });
    bindDelegatedClick(list, "adPause", "[data-pause-ad]", async (button) => {
      await publicApi(`/app/ads/${button.dataset.pauseAd}/pause`, { method: "POST" });
      showNotice("Ad paused in CRM.");
      await loadAds();
    });
    bindDelegatedClick(list, "adResume", "[data-resume-ad]", async (button) => {
      await publicApi(`/app/ads/${button.dataset.resumeAd}/resume`, { method: "POST" });
      showNotice("Ad resumed in CRM.");
      await loadAds();
    });
    bindDelegatedClick(list, "adOpenManager", "[data-open-ad-manager]", () => {
      window.open(state.ads.adsManagerUrl, "_blank", "noopener,noreferrer");
    });
  }

  renderAdPreview();
  refreshIcons();
}

function renderAdPreview() {
  const target = $("#adPreview");
  if (!target) return;
  const payload = collectAdPayload(state.ads.editingId ? "READY_TO_PUBLISH" : "DRAFT");
  const headline = payload.creativeConfig.headline || "Message us on WhatsApp";
  const body = payload.creativeConfig.primaryText || "Start a WhatsApp conversation from this ad.";
  const cta = payload.creativeConfig.cta || "Send WhatsApp Message";
  const opening = payload.automationConfig.welcomeText || "Hi, I want to know more.";
  const platform = pretty(payload.platform);
  const budget = payload.budgetConfig.dailyBudget ? `${payload.budgetConfig.dailyBudget}/day` : payload.budgetConfig.lifetimeBudget ? `${payload.budgetConfig.lifetimeBudget} lifetime` : "Budget not set";
  setText("adStartingPreview", opening);
  const review = $("#adReview");
  if (review) {
    review.innerHTML = [
      ["Ad account", state.ads.connection?.adAccount?.name || "Connected account from vault"],
      ["Page", state.ads.connection?.facebookPage?.name || "Facebook Page from vault"],
      ["WhatsApp number", payload.automationConfig.whatsappNumber || state.ads.connection?.whatsApp?.displayPhoneNumber || "WhatsApp integration"],
      ["Budget", budget],
      ["Creative", `${headline} - ${cta}`],
      ["Audience", payload.audienceConfig.manualTargeting || pretty(payload.audienceConfig.type)],
      ["Automation", payload.automationConfig.humanQueueHighIntent ? "Human queue for high intent enabled" : "Standard CRM tracking"],
      ["Compliance", "Opt-in, WhatsApp policy, Page identity, and Meta review remain required"]
    ].map(([label, value]) => `<span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></span>`).join("");
  }
  target.innerHTML = `
    <article class="ad-card-preview">
      <small class="ad-platform">${escapeHtml(platform)} - ${escapeHtml(budget)}</small>
      <span class="ad-media"><i data-lucide="messages-square"></i></span>
      <strong>${escapeHtml(headline)}</strong>
      <p>${escapeHtml(body)}</p>
      <button type="button">${escapeHtml(cta)}</button>
    </article>
    <article class="phone-preview">
      <span>WhatsApp opening message</span>
      <p>${escapeHtml(opening)}</p>
    </article>
  `;
  refreshIcons();
}

function resetAdWizard() {
  state.ads.editingId = null;
  $("#adWizardForm")?.reset();
  if ($("#adCta")) $("#adCta").value = "Send WhatsApp Message";
  document.querySelector("input[name='adObjective'][value='CLICK_TO_WHATSAPP']")?.click();
  setAdWizardStep(1);
}

function setAdWizardBusy(busy) {
  $("#adWizardForm")?.querySelectorAll("button, input, select, textarea").forEach((element) => {
    element.disabled = busy;
  });
}

async function saveAdFromWizard(action) {
  const status = action === "LAUNCH" ? "READY_TO_PUBLISH" : action;
  const payload = collectAdPayload(status);
  setAdWizardBusy(true);
  try {
    const saved = state.ads.editingId
      ? await publicApi(`/app/ads/${state.ads.editingId}`, { method: "PATCH", body: JSON.stringify(payload) })
      : await publicApi("/app/ads", { method: "POST", body: JSON.stringify(payload) });
    const campaign = saved.campaign;
    state.ads.editingId = campaign?.id || state.ads.editingId;

    if (action === "LAUNCH") {
      await publicApi(`/app/ads/${state.ads.editingId}/launch`, { method: "POST" });
      showNotice("Ad launch requested.");
    } else {
      showNotice(action === "READY_TO_PUBLISH" ? "Ad saved as ready to publish." : "Ad draft saved.");
    }

    await loadAds();
  } finally {
    setAdWizardBusy(false);
    setAdWizardStep(state.ads.wizardStep);
  }
}

const flowDefaults = {
  start: { label: "Start trigger", config: { trigger: "keyword" } },
  text: { label: "Send message", config: { text: "Thanks for reaching out. How can our team help?" } },
  media: { label: "Media Buttons", config: { mediaUrl: "", caption: "" } },
  list: { label: "List", config: { title: "Choose an option" } },
  catalogue: { label: "Catalogue Message", config: { catalogueId: "" } },
  single_product: { label: "Single Product", config: { productId: "" } },
  multi_product: { label: "Multi Product", config: { productIds: "" } },
  template: { label: "Send template", config: { templateName: "", templateLanguage: "en_US" } },
  question: { label: "Ask question", config: { text: "What quantity do you need?" } },
  delay: { label: "Wait for reply", config: { seconds: 2 } },
  condition: { label: "Condition", config: { field: "message", contains: "quote" } },
  connect_flow: { label: "Connect Flow", config: { workflowId: "" } },
  ask_address: { label: "Ask Address", config: { attribute: "address" } },
  ask_location: { label: "Ask Location", config: { attribute: "location" } },
  ask_media: { label: "Ask Media", config: { attribute: "media" } },
  meta_conversions: { label: "Meta Conversions API", config: { eventName: "Lead" } },
  add_tag: { label: "Add tag", config: { tag: "workflow" } },
  set_attribute: { label: "Set Attribute", config: { key: "interest", value: "" } },
  set_status: { label: "Set lead status", config: { status: "WARM" } },
  human_takeover: { label: "Request human takeover", config: { reason: "Workflow requested human follow-up" } },
  order_draft: { label: "Create order draft", config: { productType: "Customer request", confidence: "draft" } },
  api_request: { label: "API request", config: { url: "", method: "POST" } },
  end: { label: "End flow", config: { outcome: "completed" } }
};

async function loadWorkflows() {
  try {
    const data = await publicApi("/ai-flows");
    state.workflows = data.workflows || [];
    if (!state.activeWorkflowId && state.workflows[0]) loadWorkflowIntoDraft(state.workflows[0]);
    renderWorkflowList();
    renderFlowCanvas();
  } catch (error) {
    if (error.setupRequired) {
      state.workflows = [];
      renderFlowCanvas();
      renderSetupRequired(["#workflowList"], error);
      return;
    }
    throw error;
  }
}

function loadWorkflowIntoDraft(workflow) {
  state.activeWorkflowId = workflow.id;
  state.workflowDraft = {
    ...state.workflowDraft,
    id: workflow.id,
    name: workflow.name,
    triggerType: workflow.triggerType,
    triggerValue: workflow.triggerValue,
    isActive: workflow.isActive,
    selectedNodeId: null,
    pendingConnectionId: null,
    definition: workflow.definition || { nodes: [], edges: [] }
  };
  if ($("#workflowName")) $("#workflowName").value = workflow.name;
  if ($("#workflowTriggerType")) $("#workflowTriggerType").value = workflow.triggerType;
  if ($("#workflowTriggerValue")) $("#workflowTriggerValue").value = workflow.triggerValue;
  renderFlowCanvas();
  renderWorkflowList();
}

function renderWorkflowList() {
  const target = $("#workflowList");
  if (!target) return;
  const search = state.workflowSearch.toLowerCase();
  const workflows = state.workflows.filter((workflow) => !search || workflow.name.toLowerCase().includes(search));
  setText("workflowListSummary", `${workflows.length} saved automation${workflows.length === 1 ? "" : "s"} in this workspace.`);
  setHtmlIfChanged($("#toggleWorkflowActiveBtn"), `<i data-lucide="power"></i>${state.workflowDraft.isActive ? "Active" : "Inactive"}`);
  target.innerHTML = workflows.length
    ? `
      <div class="data-table flow-table">
        <div class="data-row data-head"><span>Flow Name</span><span>Created By</span><span>Status</span><span>Actions</span></div>
        ${workflows.map((workflow) => `
          <div class="data-row flow-row ${workflow.id === state.activeWorkflowId ? "active" : ""}" data-load-workflow="${escapeHtml(workflow.id)}">
            <span><strong>${escapeHtml(workflow.name)}</strong><small>${escapeHtml(pretty(workflow.triggerType))}: ${escapeHtml(workflow.triggerValue)}</small></span>
            <span>${escapeHtml(state.session?.username || "CRM OS")}</span>
            <span><button class="toggle-switch ${workflow.isActive ? "is-on" : "is-off"}" type="button" data-toggle-workflow="${escapeHtml(workflow.id)}" aria-label="Toggle flow status"><span class="toggle-track"><i></i></span></button></span>
            <span class="row-actions">
              <button class="secondary-button icon-button" type="button" data-duplicate-workflow="${escapeHtml(workflow.id)}" aria-label="Duplicate flow"><i data-lucide="copy"></i></button>
              <button class="secondary-button icon-button" type="button" data-edit-workflow="${escapeHtml(workflow.id)}" aria-label="Edit flow"><i data-lucide="pencil"></i></button>
              <button class="danger-button icon-button" type="button" data-delete-workflow="${escapeHtml(workflow.id)}" aria-label="Delete flow"><i data-lucide="trash-2"></i></button>
            </span>
          </div>
        `).join("")}
      </div>
    `
    : emptyState("No saved automations yet.", "Save this canvas to create your first flow.");
  renderWorkflowLogs();
  bindDelegatedClick(target, "loadWorkflow", "[data-load-workflow]", (row, event) => {
    if (event.target.closest("[data-toggle-workflow], [data-duplicate-workflow], [data-edit-workflow], [data-delete-workflow]")) return;
    const workflow = state.workflows.find((item) => item.id === row.dataset.loadWorkflow);
    if (workflow) loadWorkflowIntoDraft(workflow);
  });
  bindDelegatedClick(target, "workflowEdit", "[data-edit-workflow]", (button) => {
    const workflow = state.workflows.find((item) => item.id === button.dataset.editWorkflow);
    if (workflow) {
      loadWorkflowIntoDraft(workflow);
      $("#flowCanvas")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
  bindDelegatedClick(target, "workflowToggle", "[data-toggle-workflow]", async (button) => {
    const workflow = state.workflows.find((item) => item.id === button.dataset.toggleWorkflow);
    if (!workflow) return;
    await publicApi(`/ai-flows/${workflow.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: !workflow.isActive })
    });
    showNotice(!workflow.isActive ? "Flow activated." : "Flow deactivated.");
    await loadWorkflows();
  });
  bindDelegatedClick(target, "workflowDuplicate", "[data-duplicate-workflow]", async (button) => {
    await publicApi(`/ai-flows/${button.dataset.duplicateWorkflow}/duplicate`, { method: "POST" });
    showNotice("Flow duplicated.");
    await loadWorkflows();
  });
  bindDelegatedClick(target, "workflowDelete", "[data-delete-workflow]", async (button) => {
    if (!window.confirm("Delete this flow?")) return;
    await publicApi(`/ai-flows/${button.dataset.deleteWorkflow}`, { method: "DELETE" });
    showNotice("Flow deleted.");
    if (state.activeWorkflowId === button.dataset.deleteWorkflow) resetWorkflowDraft();
    await loadWorkflows();
  });
  refreshIcons();
}

function renderWorkflowLogs() {
  const target = $("#workflowLogs");
  if (!target) return;
  const logs = state.workflows.flatMap((workflow) =>
    (workflow.executionLogs || []).map((log) => ({
      ...log,
      workflowName: workflow.name
    }))
  );

  if (!logs.length) {
    target.innerHTML = `
      <article><strong>No workflow runs yet</strong><span>Execution logs appear after active triggers match inbound WhatsApp messages.</span></article>
      <article><strong>Human fallback ready</strong><span>Failed workflow steps request human takeover automatically.</span></article>
    `;
    return;
  }

  target.innerHTML = logs
    .slice(0, 6)
    .map((log) => `
      <article>
        <strong>${escapeHtml(log.workflowName)}</strong>
        <span>${escapeHtml(pretty(log.status))}${log.stepKey ? ` - ${escapeHtml(log.stepKey)}` : ""}</span>
      </article>
    `)
    .join("");
}

function flowNodeHtml(node) {
  const icon = {
    start: "play",
    text: "message-square",
    media: "image",
    list: "list",
    catalogue: "store",
    single_product: "shopping-cart",
    multi_product: "shopping-bag",
    template: "badge-check",
    question: "circle-help",
    delay: "timer",
    condition: "git-branch",
    add_tag: "tag",
    set_attribute: "square-code",
    connect_flow: "waypoints",
    ask_address: "map-pinned",
    ask_location: "map-pin",
    ask_media: "file-image",
    meta_conversions: "file-symlink",
    set_status: "activity",
    human_takeover: "user-round-check",
    order_draft: "package-plus",
    api_request: "cloud-cog",
    end: "circle-stop"
  }[node.type] || "workflow";
  return `
    <article class="flow-node ${state.workflowDraft.selectedNodeId === node.id ? "selected" : ""}" data-flow-node="${escapeHtml(node.id)}" style="left:${node.x || 80}px; top:${node.y || 80}px">
      <span><i data-lucide="${icon}"></i>${escapeHtml(node.label || pretty(node.type))}</span>
      <small>${escapeHtml(pretty(node.type))}</small>
      <button class="flow-connect" type="button" data-flow-connect="${escapeHtml(node.id)}" aria-label="Connect block"><i data-lucide="waypoints"></i></button>
    </article>
  `;
}

function renderFlowCanvas() {
  const canvas = $("#flowCanvas");
  if (!canvas) return;
  const draft = state.workflowDraft;
  const nodes = draft.definition.nodes || [];
  const edges = draft.definition.edges || [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const lines = edges
    .map((edge) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) return "";
      return `<line x1="${(from.x || 0) + 120}" y1="${(from.y || 0) + 36}" x2="${to.x || 0}" y2="${(to.y || 0) + 36}" />`;
    })
    .join("");
  canvas.innerHTML = `
    <div class="flow-canvas-content" style="transform: translate(${draft.panX}px, ${draft.panY}px) scale(${draft.zoom})">
      <svg class="flow-lines">${lines}</svg>
      ${nodes.map(flowNodeHtml).join("")}
    </div>
  `;
  renderFlowConfig();
  refreshIcons();
}

function renderFlowConfig() {
  const form = $("#flowConfigForm");
  if (!form) return;
  const node = state.workflowDraft.definition.nodes.find((item) => item.id === state.workflowDraft.selectedNodeId);
  if (!node) {
    setText("flowConfigTitle", "Select a block");
    form.innerHTML = "";
    return;
  }

  setText("flowConfigTitle", node.label || pretty(node.type));
  const config = node.config || {};
  const fields = [["label", node.label || ""]];
  Object.entries(config).forEach(([key, value]) => fields.push([key, value]));
  form.innerHTML = fields.map(([key, value]) => `
    <label>${escapeHtml(pretty(key))}
      <input data-flow-config="${escapeHtml(key)}" value="${escapeHtml(value)}" />
    </label>
  `).join("");
}

function addFlowNode(type, x = 180, y = 180) {
  const defaults = flowDefaults[type] || { label: pretty(type), config: {} };
  const node = {
    id: `${type}-${Date.now()}`,
    type,
    label: defaults.label,
    x,
    y,
    config: { ...defaults.config }
  };
  state.workflowDraft.definition.nodes.push(node);
  state.workflowDraft.selectedNodeId = node.id;
  renderFlowCanvas();
}

function resetWorkflowDraft() {
  const id = `start-${Date.now()}`;
  state.activeWorkflowId = null;
  state.workflowDraft = {
    ...state.workflowDraft,
    id: null,
    name: "",
    triggerType: "KEYWORD",
    triggerValue: "",
    isActive: false,
    selectedNodeId: id,
    pendingConnectionId: null,
    definition: {
      nodes: [{ id, type: "start", label: "Flow Start", x: 650, y: 260, config: { trigger: "keyword" } }],
      edges: []
    }
  };
  if ($("#workflowName")) $("#workflowName").value = "";
  if ($("#workflowTriggerType")) $("#workflowTriggerType").value = "KEYWORD";
  if ($("#workflowTriggerValue")) $("#workflowTriggerValue").value = "";
  renderFlowCanvas();
  renderWorkflowList();
}

async function saveWorkflow() {
  const body = {
    name: $("#workflowName")?.value.trim() || "Untitled workflow",
    triggerType: $("#workflowTriggerType")?.value || "KEYWORD",
    triggerValue: $("#workflowTriggerValue")?.value.trim() || "hi",
    isActive: state.workflowDraft.isActive,
    definition: state.workflowDraft.definition
  };
  const path = state.workflowDraft.id ? `/ai-flows/${state.workflowDraft.id}` : "/ai-flows";
  const method = state.workflowDraft.id ? "PATCH" : "POST";
  const data = await publicApi(path, { method, body: JSON.stringify(body) });
  showNotice("Workflow saved.");
  await loadWorkflows();
  loadWorkflowIntoDraft(data.workflow);
}

function connectChatEvents() {
  if (!window.EventSource) {
    console.warn("[Dashboard] EventSource is not supported in this browser.");
    return;
  }

  const events = new EventSource("/api/events");
  function handleChatEvent(event) {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (error) {
      logDashboardError("Invalid chat event payload", error, { type: "eventsource" });
      return;
    }

    if (data.type === "message.created" && data.leadId) {
      const message = normalizeMessage(data.payload?.message);
      state.leads = state.leads.map((lead) =>
        lead.id === data.leadId
          ? {
              ...lead,
              lastMessage: message.text,
              lastMessageAt: message.timestamp,
              updatedAt: message.timestamp,
              unreadCount: message.direction === "INBOUND" ? Number(lead.unreadCount || 0) + 1 : 0
            }
          : lead
      );

      if (state.selectedConversation?.lead?.id === data.leadId) {
        state.selectedConversation = {
          ...state.selectedConversation,
          messages: normalizeMessages([
            ...state.selectedConversation.messages.filter((item) => item.id !== message.id),
            message
          ])
        };
        renderConversation(state.selectedConversation, { forceBottom: isNearBottom($("#chatThread")) });
      } else {
        renderChatList();
      }
    }

    if (data.type === "lead.updated" && data.leadId) {
      state.leads = state.leads.map((lead) =>
        lead.id === data.leadId ? { ...lead, ...(data.payload?.lead || {}) } : lead
      );
      if (state.selectedConversation?.lead?.id === data.leadId) {
        state.selectedConversation = {
          ...state.selectedConversation,
          lead: { ...state.selectedConversation.lead, ...(data.payload?.lead || {}) }
        };
        renderConversation(state.selectedConversation, { forceBottom: isNearBottom($("#chatThread")) });
      } else {
        renderChatList();
      }
    }

    if (["message.created", "lead.updated", "order.updated"].includes(data.type)) {
      refreshCommandCenterSilently();
    }
  }

  events.addEventListener("message.created", handleChatEvent);
  events.addEventListener("lead.updated", handleChatEvent);
  events.addEventListener("message.status", handleChatEvent);
  events.addEventListener("order.updated", handleChatEvent);
  events.addEventListener("open", () => setConnectionStatus("connected"));

  events.addEventListener("error", (error) => {
    logDashboardError("Chat event stream error", error);
    setConnectionStatus("error", "Reconnecting...");
  });
}

function setTemperatureFilter(value) {
  state.temperatureFilter = value || "";
  const select = $("#temperatureFilter");
  if (select) select.value = state.temperatureFilter;
  document.querySelectorAll("[data-temperature-tab]").forEach((tab) => {
    tab.classList.toggle("active", (tab.dataset.temperatureTab || "") === state.temperatureFilter);
  });
  document.querySelectorAll(".nav-item[data-view='leads']:not([data-temperature-tab])").forEach((button) => {
    button.classList.toggle("active", state.currentView === "leads" && !state.temperatureFilter);
  });
}

function switchView(name) {
  if (!featureEnabledForView(name)) {
    renderFeatureDisabled(name);
    showNotice("Feature disabled by admin.", true);
    return;
  }

  state.currentView = name;
  document.body.dataset.activeView = name;
  if (window.location.hash !== `#${name}`) {
    window.history.replaceState(null, "", `#${name}`);
  }
  document.body.classList.toggle("chat-mode", name === "chats");
  document.body.classList.toggle("command-mode", name === "overview");
  const activated = new Set();
  Object.entries(views).forEach(([key, element]) => {
    if (!element || activated.has(element)) return;
    activated.add(element);
    const active = key === name;
    element.classList.toggle("active-view", active);
  });
  document.querySelectorAll(".nav-item").forEach((button) => {
    const isSegment = button.dataset.temperatureTab !== undefined;
    const isSelectedSegment = name === "leads" && isSegment && (button.dataset.temperatureTab || "") === state.temperatureFilter;
    const isPrimaryView = !isSegment && button.dataset.view === name;
    button.classList.toggle("active", isPrimaryView || isSelectedSegment);
  });
  runMotion(name === "overview" ? ".conversation-pulse-panel, .priority-queue-panel, .secondary-signal-panel" : ".premium-card, .lead-card, .chat-list-row");
  if (name === "overview") loadOverview();
  if (name === "leads" || name === "chats") loadLeads().catch((error) => showNotice(error.message, true));
  if (name === "broadcasts") {
    loadContacts().catch((error) => showNotice(error.message, true));
    loadBulkJobs().catch((error) => showNotice(error.message, true));
  }
  if (name === "campaigns") loadCampaigns().catch((error) => showNotice(error.message, true));
  if (name === "ads") loadAds().catch((error) => showNotice(error.message, true));
  if (name === "flows") loadWorkflows().catch((error) => showNotice(error.message, true));
  if (name === "orders") loadOrderData().catch((error) => showNotice(error.message, true));
  if (name === "human") loadOperationalData().catch((error) => showNotice(error.message, true));
  if (name === "reports") {
    if (state.latestOverview) renderAnalytics(state.latestOverview.stats || {});
    else loadOverview().catch((error) => showNotice(error.message, true));
    if (featureEnabledForView("broadcasts")) {
      loadBulkJobs().catch((error) => logDashboardError("Broadcast report load failed", error));
    }
    if (featureEnabledForView("campaigns")) {
      loadCampaigns().catch((error) => logDashboardError("Campaign report load failed", error));
    }
    if (featureEnabledForView("flows")) {
      loadWorkflows().catch((error) => logDashboardError("Workflow report load failed", error));
    }
    if (featureEnabledForView("orders")) {
      loadOrderData().catch((error) => logDashboardError("Order report load failed", error));
    }
  }
}

async function refreshCurrentView() {
  if (state.isRefreshing) return;
  state.isRefreshing = true;
  const snapshot = captureUiState();
  try {
    await Promise.all([
      featureEnabledForView("overview") ? loadOverview() : Promise.resolve(),
      featureEnabledForView("chats") ? loadLeads() : Promise.resolve(),
      featureEnabledForView("human") || featureEnabledForView("orders") ? loadOperationalData() : Promise.resolve()
    ]);
    if (featureEnabledForView("chats") && state.selectedLeadId) await loadConversation(state.selectedLeadId, { forceBottom: isNearBottom($("#chatThread")) });
  } finally {
    state.isRefreshing = false;
    restoreUiState(snapshot);
  }
}

async function pollDashboardData() {
  if (document.hidden || state.isRefreshing || state.isPolling) return;
  state.isPolling = true;
  const selectedLeadId = state.selectedLeadId;
  const forceBottom = isNearBottom($("#chatThread"));

  try {
    if (featureEnabledForView("chats")) await loadLeads({ updateOverview: false });
    if (featureEnabledForView("chats") && selectedLeadId) {
      await loadConversation(selectedLeadId, { forceBottom });
    }
    if ((state.currentView === "overview" && featureEnabledForView("overview")) || (state.currentView === "reports" && featureEnabledForView("reports"))) {
      const [dashboardResult, commandCenterResult] = await Promise.allSettled([
        dashboardApi(),
        commandCenterApi(state.selectedPulseSegment)
      ]);
      if (dashboardResult.status === "fulfilled") {
        const data = dashboardResult.value;
        state.latestOverview = data;
        state.humanActionQueue = data.humanActionQueue || data.items || [];
        state.orderPipeline = data.orderPipeline || data.pipeline || {};
        renderDerivedOverview();
      } else {
        throw dashboardResult.reason;
      }

      if (commandCenterResult.status === "fulfilled") {
        state.commandCenter = commandCenterResult.value;
        renderCommandCenter(commandCenterResult.value);
      } else {
        logDashboardError("Command Center polling signals failed", commandCenterResult.reason);
        renderCommandCenter(state.commandCenter || emptyCommandCenterData());
      }
    } else if (state.currentView === "orders" && featureEnabledForView("orders")) {
      await loadOrderData();
    } else if (state.currentView === "human" && featureEnabledForView("human")) {
      await loadOperationalData();
    }
    setConnectionStatus("connected");
  } catch (error) {
    logDashboardError("Dashboard polling failed", error);
    setConnectionStatus("error", "Reconnecting...");
  } finally {
    state.isPolling = false;
  }
}

function startDashboardPolling() {
  window.setInterval(() => {
    pollDashboardData();
  }, DASHBOARD_POLL_INTERVAL_MS);
  window.setInterval(() => {
    renderCommandCenterFreshness();
  }, 15000);
}

function clearClientSessionState() {
  state.session = null;
  state.features = [];
  state.enabledFeatureKeys = new Set();
  try {
    window.sessionStorage?.clear();
    window.localStorage?.removeItem("crm_session");
  } catch {
    // Storage cleanup is best-effort; the server cookie is the source of truth.
  }
}

async function logoutFromClient(form) {
  const button = form?.querySelector("button[type='submit'], button");
  const previousText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Logging out...";
  }

  try {
    const response = await fetch("/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    clearClientSessionState();
    window.location.replace(data.redirectTo || "/login");
  } catch {
    clearClientSessionState();
    window.location.replace("/login");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousText || "Logout";
    }
  }
}

function bindSessionRestoreGuard() {
  window.addEventListener("pageshow", async (event) => {
    if (!event.persisted) return;
    try {
      const response = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) window.location.replace("/login");
    } catch {
      window.location.replace("/login");
    }
  });
}

function bindEvents() {
  document.querySelectorAll("[data-logout-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      logoutFromClient(form);
    });
  });

  $("#profileMenuButton")?.addEventListener("click", () => {
    $("#profileLogoutMenu")?.classList.toggle("hidden");
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#profileMenuButton") && !event.target.closest("#profileLogoutMenu")) {
      $("#profileLogoutMenu")?.classList.add("hidden");
    }
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  $("#featureToggleList")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-feature-toggle]");
    if (!button) return;
    try {
      const enabled = button.getAttribute("aria-checked") !== "true";
      button.disabled = true;
      const data = await publicApi(`/admin/features/${button.dataset.featureToggle}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled })
      });
      state.features = data.features || state.features;
      state.enabledFeatureKeys = new Set(state.features.map((feature) => feature.key));
      applyFeatureVisibility();
      showNotice("Entitlements updated.");
    } catch (error) {
      button.disabled = false;
      showNotice(error.message, true);
    }
  });

  document.querySelectorAll("[data-temperature-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      setTemperatureFilter(tab.dataset.temperatureTab || "");
      loadLeads().catch((error) => showNotice(error.message, true));
    });
  });

  let leadSearchTimer;
  $("#leadSearch")?.addEventListener("input", (event) => {
    state.leadSearch = event.target.value.trim();
    window.clearTimeout(leadSearchTimer);
    leadSearchTimer = window.setTimeout(() => loadLeads().catch((error) => showNotice(error.message, true)), 180);
  });

  let chatSearchTimer;
  $("#chatSearch")?.addEventListener("input", (event) => {
    state.chatSearch = event.target.value.trim();
    window.clearTimeout(chatSearchTimer);
    chatSearchTimer = window.setTimeout(renderChatList, 120);
  });

  document.querySelectorAll("[data-chat-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.chatFilter = button.dataset.chatFilter || "all";
      renderChatList();
    });
  });

  document.querySelectorAll("[data-chat-temperature]").forEach((button) => {
    button.addEventListener("click", () => {
      state.chatTemperatureFilter = button.dataset.chatTemperature || "";
      renderChatList();
    });
  });

  $("#globalSearch")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    state.leadSearch = event.currentTarget.value.trim();
    $("#leadSearch").value = state.leadSearch;
    switchView("leads");
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
      event.preventDefault();
      $("#globalSearch")?.focus();
    }
  });

  $("#temperatureFilter")?.addEventListener("change", (event) => {
    setTemperatureFilter(event.target.value);
    loadLeads().catch((error) => showNotice(error.message, true));
  });

  let contactSearchTimer;
  $("#contactSearch")?.addEventListener("input", (event) => {
    state.contactFilters.search = event.target.value.trim();
    window.clearTimeout(contactSearchTimer);
    contactSearchTimer = window.setTimeout(() => loadContacts().catch((error) => showNotice(error.message, true)), 180);
  });

  ["contactTagFilter", "contactStatusFilter", "contactSourceFilter"].forEach((id) => {
    $(`#${id}`)?.addEventListener("change", (event) => {
      const key = id === "contactTagFilter" ? "tag" : id === "contactStatusFilter" ? "status" : "source";
      state.contactFilters[key] = event.target.value;
      loadContacts().catch((error) => showNotice(error.message, true));
    });
  });

  $("#addContactBtn")?.addEventListener("click", () => {
    addContactFromPrompt().catch((error) => showNotice(error.message, true));
  });

  $("#importSheetsContactsBtn")?.addEventListener("click", async () => {
    try {
      if (!integrationConnected("googleSheets")) throw new Error("Google Sheets not connected.");
      const result = await publicApi("/contacts/import/google-sheets", { method: "POST" });
      showNotice(`Imported ${result.imported || 0} contacts from Google Sheets.`);
      await loadContacts();
    } catch (error) {
      showNotice(error.message, true);
    }
  });

  $("#csvFileInput")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    $("#csvTextInput").value = await file.text();
    renderCsvPreview();
  });

  $("#csvTextInput")?.addEventListener("input", renderCsvPreview);
  $("#csvDefaultTags")?.addEventListener("input", renderCsvPreview);

  $("#csvImportForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await publicApi("/contacts/import/csv", {
        method: "POST",
        body: JSON.stringify({
          csvText: $("#csvTextInput")?.value || "",
          defaultTags: commaList($("#csvDefaultTags")?.value || ""),
          source: "csv"
        })
      });
      showNotice(`Imported ${result.imported} contacts. ${result.skipped} skipped.`);
      await loadContacts();
    } catch (error) {
      showNotice(error.message, true);
    }
  });

  $("#selectAllContactsBtn")?.addEventListener("click", () => {
    const allSelected = state.contacts.every((contact) => state.selectedContactIds.has(contact.id));
    if (allSelected) state.contacts.forEach((contact) => state.selectedContactIds.delete(contact.id));
    else state.contacts.forEach((contact) => state.selectedContactIds.add(contact.id));
    renderContacts();
    updateBroadcastPreview();
  });

  $("#focusBroadcastBtn")?.addEventListener("click", () => {
    $("#bulkName")?.scrollIntoView({ behavior: "smooth", block: "center" });
    $("#bulkName")?.focus();
  });

  $("#csvImportShortcutBtn")?.addEventListener("click", () => {
    $("#csvFileInput")?.scrollIntoView({ behavior: "smooth", block: "center" });
    $("#csvFileInput")?.focus();
  });

  $("#newTemplateBtn")?.addEventListener("click", () => {
    $("#templateDialog")?.showModal();
    refreshIcons();
  });

  document.querySelectorAll("[data-template-var]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = $("#templateContentInput");
      if (!input) return;
      const token = button.dataset.templateVar || "";
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.value = `${input.value.slice(0, start)}${token}${input.value.slice(end)}`;
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
      updateBroadcastPreview();
    });
  });

  $("#templateForm")?.addEventListener("submit", (event) => {
    const submitter = event.submitter;
    if (submitter?.value === "cancel") return;
    event.preventDefault();
    const templateName = $("#templateMetaNameInput")?.value.trim() || $("#templateNameInput")?.value.trim();
    if (!templateName) {
      showNotice("Template name is required.", true);
      return;
    }
    if ($("#bulkTemplateName")) $("#bulkTemplateName").value = templateName;
    updateBroadcastPreview();
    $("#templateDialog")?.close();
    showNotice("Template prepared for broadcast send.");
  });

  ["bulkTemplateName", "templateContentInput", "bulkAudienceTag", "bulkAudienceSource"].forEach((id) => {
    $(`#${id}`)?.addEventListener("input", updateBroadcastPreview);
  });

  $("#bulkSendForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      if (!integrationConnected("whatsapp")) throw new Error("WhatsApp not connected for your company.");
      const body = {
        name: $("#bulkName")?.value.trim() || "Bulk WhatsApp template send",
        templateName: $("#bulkTemplateName")?.value.trim(),
        templateLanguage: $("#bulkTemplateLanguage")?.value.trim() || "en_US",
        audience: selectedAudienceFromContacts({
          tag: $("#bulkAudienceTag")?.value.trim(),
          source: $("#bulkAudienceSource")?.value.trim()
        })
      };
      await publicApi("/bulk-messages", { method: "POST", body: JSON.stringify(body) });
      showNotice("Bulk send queued.");
      await loadBulkJobs();
    } catch (error) {
      showNotice(error.message, true);
    }
  });

  $("#refreshBulkJobsBtn")?.addEventListener("click", () => {
    loadBulkJobs().catch((error) => showNotice(error.message, true));
  });

  $("#campaignForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitter = event.submitter;
    const scheduleNow = submitter?.dataset.campaignSubmit === "now";
    const localValue = $("#campaignScheduledAt")?.value;
    const audienceSourceType = $("#campaignAudienceSourceType")?.value || "all";
    try {
      if (audienceSourceType === "csv" && $("#campaignCsvFile")?.files?.[0]) {
        const csvText = await $("#campaignCsvFile").files[0].text();
        const result = await publicApi("/contacts/import/csv", {
          method: "POST",
          body: JSON.stringify({ csvText, source: "campaign_csv" })
        });
        showNotice(`Campaign CSV imported ${result.imported || 0} contacts. ${result.skipped || 0} skipped.`);
      }
      if (audienceSourceType === "sheets") {
        if (!integrationConnected("googleSheets")) throw new Error("Google Sheets not connected.");
        const result = await publicApi("/contacts/import/google-sheets", { method: "POST" });
        showNotice(`Google Sheets synced ${result.imported || 0} contacts for campaign audience.`);
      }
      if (!integrationConnected("whatsapp")) throw new Error("WhatsApp not connected for your company.");
      const audience = audienceSourceType === "manual"
        ? selectedAudienceFromContacts({})
        : selectedAudienceFromContacts({
            tag: audienceSourceType === "tag" ? $("#campaignAudienceTag")?.value.trim() : "",
            source: audienceSourceType === "csv" ? "campaign_csv" : $("#campaignAudienceSource")?.value.trim()
          });
      await publicApi("/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: $("#campaignName")?.value.trim(),
          audience,
          templateName: $("#campaignTemplateName")?.value.trim(),
          messagePreview: $("#campaignPreview")?.value.trim(),
          scheduledAt: !scheduleNow && localValue ? new Date(localValue).toISOString() : null,
          scheduleNow
        })
      });
      showNotice(scheduleNow ? "Campaign is running." : "Campaign scheduled.");
      await loadCampaigns();
    } catch (error) {
      showNotice(error.message, true);
    }
  });

  $("#campaignAudienceSourceType")?.addEventListener("change", (event) => {
    const label = {
      all: "All contacts in the CRM will be eligible for this campaign.",
      tag: "Contacts matching the audience tag will be selected.",
      csv: "Upload a CSV with name, phone, tags, source. Contacts are imported safely before campaign creation.",
      sheets: "Google Sheets contacts are synced before campaign creation.",
      manual: "Contacts selected in Contacts are used as the broadcast audience."
    }[event.target.value] || "";
    setText("campaignAudienceSummary", label);
  });

  $("#launchCampaignBtn")?.addEventListener("click", () => {
    $("#campaignForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    $("#campaignName")?.focus();
  });

  [
    "adHeadline",
    "adPrimaryText",
    "adDescription",
    "adCta",
    "adWelcomeText",
    "adPlatform",
    "adDailyBudget",
    "adLifetimeBudget",
    "adAudienceText",
    "adAudienceType",
    "adWhatsappNumber",
    "adPhoneNumberId",
    "adTimezone",
    "adUtm",
    "adName"
  ].forEach((id) => {
    $(`#${id}`)?.addEventListener("input", renderAdPreview);
    $(`#${id}`)?.addEventListener("change", renderAdPreview);
  });

  document.querySelectorAll("[data-ad-step]").forEach((button) => {
    button.addEventListener("click", () => setAdWizardStep(button.dataset.adStep));
  });

  document.querySelectorAll("[data-ad-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.ads.filter = button.dataset.adFilter || "ALL";
      renderAds();
    });
  });

  $("#createAdBtn")?.addEventListener("click", () => {
    resetAdWizard();
    $("#adWizard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    $("#adName")?.focus();
  });

  $("#openAdsManagerBtn")?.addEventListener("click", () => {
    window.open(state.ads.adsManagerUrl, "_blank", "noopener,noreferrer");
  });

  $("#syncAdsBtn")?.addEventListener("click", async () => {
    const campaign = state.ads.campaigns.find((item) => item.metaAdId);
    if (!campaign) {
      showNotice("Map a Meta Ad ID before syncing insights.", true);
      return;
    }
    try {
      const result = await publicApi(`/app/ads/${campaign.id}/sync-insights`, { method: "POST" });
      showNotice(result.message || "Ads sync complete.");
      await loadAds();
    } catch (error) {
      showNotice(error.message, true);
    }
  });

  $("#prevAdStepBtn")?.addEventListener("click", () => setAdWizardStep(state.ads.wizardStep - 1));
  $("#nextAdStepBtn")?.addEventListener("click", () => setAdWizardStep(state.ads.wizardStep + 1));

  $("#adWizardForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitter = event.submitter || document.activeElement;
    const action = submitter?.dataset?.adSubmit || "DRAFT";
    try {
      await saveAdFromWizard(action);
    } catch (error) {
      showNotice(error.message, true);
    }
  });

  document.querySelectorAll("[data-flow-block]").forEach((button) => {
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", button.dataset.flowBlock);
    });
  });

  $("#workflowSearch")?.addEventListener("input", (event) => {
    state.workflowSearch = event.target.value.trim();
    renderWorkflowList();
  });

  document.querySelectorAll("[data-flow-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-flow-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
      const tab = button.dataset.flowTab;
      if (tab === "flows") renderWorkflowList();
      else showNotice(`${button.textContent.trim()} is available from this workspace. Saved flow data remains unchanged.`);
    });
  });

  $("#flowCanvas")?.addEventListener("dragover", (event) => event.preventDefault());
  $("#flowCanvas")?.addEventListener("drop", (event) => {
    event.preventDefault();
    const type = event.dataTransfer.getData("text/plain");
    const rect = event.currentTarget.getBoundingClientRect();
    addFlowNode(
      type,
      (event.clientX - rect.left - state.workflowDraft.panX) / state.workflowDraft.zoom,
      (event.clientY - rect.top - state.workflowDraft.panY) / state.workflowDraft.zoom
    );
  });

  let draggingNode = null;
  let dragOffset = null;
  $("#flowCanvas")?.addEventListener("mousedown", (event) => {
    const nodeElement = event.target.closest("[data-flow-node]");
    if (!nodeElement || event.target.closest("[data-flow-connect]")) return;
    const node = state.workflowDraft.definition.nodes.find((item) => item.id === nodeElement.dataset.flowNode);
    if (!node) return;
    state.workflowDraft.selectedNodeId = node.id;
    draggingNode = node;
    dragOffset = {
      x: event.clientX / state.workflowDraft.zoom - (node.x || 0),
      y: event.clientY / state.workflowDraft.zoom - (node.y || 0)
    };
    renderFlowCanvas();
  });

  window.addEventListener("mousemove", (event) => {
    if (!draggingNode || !dragOffset) return;
    draggingNode.x = Math.max(0, event.clientX / state.workflowDraft.zoom - dragOffset.x);
    draggingNode.y = Math.max(0, event.clientY / state.workflowDraft.zoom - dragOffset.y);
    renderFlowCanvas();
  });

  window.addEventListener("mouseup", () => {
    draggingNode = null;
    dragOffset = null;
  });

  bindDelegatedClick($("#flowCanvas"), "flowConnect", "[data-flow-connect]", (button, event) => {
    event.stopPropagation();
    const nodeId = button.dataset.flowConnect;
    if (!state.workflowDraft.pendingConnectionId) {
      state.workflowDraft.pendingConnectionId = nodeId;
      showNotice("Select another block connector.");
      return;
    }
    if (state.workflowDraft.pendingConnectionId !== nodeId) {
      state.workflowDraft.definition.edges.push({ from: state.workflowDraft.pendingConnectionId, to: nodeId });
    }
    state.workflowDraft.pendingConnectionId = null;
    renderFlowCanvas();
  });

  $("#flowConfigForm")?.addEventListener("input", (event) => {
    const key = event.target.dataset.flowConfig;
    if (!key) return;
    const node = state.workflowDraft.definition.nodes.find((item) => item.id === state.workflowDraft.selectedNodeId);
    if (!node) return;
    if (key === "label") node.label = event.target.value;
    else node.config = { ...(node.config || {}), [key]: event.target.value };
    renderFlowCanvas();
  });

  $("#flowZoomInBtn")?.addEventListener("click", () => {
    state.workflowDraft.zoom = Math.min(1.6, state.workflowDraft.zoom + 0.1);
    renderFlowCanvas();
  });

  $("#flowZoomOutBtn")?.addEventListener("click", () => {
    state.workflowDraft.zoom = Math.max(0.6, state.workflowDraft.zoom - 0.1);
    renderFlowCanvas();
  });

  $("#createWorkflowBtn")?.addEventListener("click", () => {
    resetWorkflowDraft();
    showNotice("New flow canvas ready.");
  });

  $("#testWorkflowBtn")?.addEventListener("click", () => {
    const blocks = state.workflowDraft.definition.nodes.length;
    showNotice(`Test prepared for ${blocks} block${blocks === 1 ? "" : "s"}. Save and activate to run from inbound WhatsApp triggers.`);
  });

  $("#saveWorkflowBtn")?.addEventListener("click", () => {
    saveWorkflow().catch((error) => showNotice(error.message, true));
  });

  $("#toggleWorkflowActiveBtn")?.addEventListener("click", () => {
    state.workflowDraft.isActive = !state.workflowDraft.isActive;
    renderWorkflowList();
  });

  $("#resolveNextBtn")?.addEventListener("click", focusHighestPriorityItem);

  $("#importLeadsBtn")?.addEventListener("click", async () => {
    try {
      if (!integrationConnected("googleSheets")) throw new Error("Google Sheets not connected.");
      const result = await publicApi("/leads/import", { method: "POST" });
      showNotice(`Imported ${result.imported} leads`);
      await refreshCurrentView();
    } catch (error) {
      showNotice(error.message, true);
    }
  });

  $("#sendInitialBtn")?.addEventListener("click", async () => {
    try {
      if (!integrationConnected("whatsapp")) throw new Error("WhatsApp not connected for your company.");
      const result = await publicApi("/messages/send-initial", { method: "POST" });
      showNotice(`Sent ${result.sent} welcome messages. ${result.failed} failed.`);
      await refreshCurrentView();
    } catch (error) {
      showNotice(error.message, true);
    }
  });

  $("#humanTakeoverBtn")?.addEventListener("click", async () => {
    if (!state.selectedLeadId) return;
    try {
      const result = await publicApi(`/human-action-queue/${state.selectedLeadId}/request`, { method: "POST" });
      state.leads = state.leads.map((lead) => (lead.id === state.selectedLeadId ? { ...lead, ...(result.lead || {}) } : lead));
      if (state.selectedConversation?.lead?.id === state.selectedLeadId) {
        state.selectedConversation = {
          ...state.selectedConversation,
          lead: { ...state.selectedConversation.lead, ...(result.lead || {}) }
        };
      }
      showNotice("Human takeover enabled for this thread.");
      setHtmlIfChanged($("#aiStatusIndicator"), `<i data-lucide="user-round-check"></i>Human in control`);
      renderHumanActionQueue();
      renderLeadProfile(state.selectedConversation?.lead);
      refreshIcons();
    } catch (error) {
      logDashboardError("Human takeover request failed", error);
      showNotice("Could not enable human takeover. Please try again.", true);
    }
  });

  $("#aiSuggestBtn")?.addEventListener("click", () => {
    const input = $("#chatReplyText");
    if (!input) return;
    const lead = state.selectedConversation?.lead;
    const suggestion = lead
      ? `Hi ${lead.name || "there"}, thanks for reaching out. I can help with that.`
      : "Select a conversation first, then use AI Suggest for a reply draft.";
    input.value = suggestion;
    input.focus();
  });

  $("#profileResolveHumanBtn")?.addEventListener("click", () => {
    if (state.selectedLeadId) resolveHumanAction(state.selectedLeadId);
  });

  $("#newMessageBtn")?.addEventListener("click", () => {
    const thread = $("#chatThread");
    if (!thread) return;
    thread.scrollTop = thread.scrollHeight;
    $("#newMessageBtn").classList.add("hidden");
  });

  document.querySelectorAll("[data-order-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const orderId = state.selectedConversation?.lead?.orderSummary?.id;
      if (orderId) performOrderAction(orderId, button.dataset.orderAction, button);
    });
  });

  $("#chatReplyForm")?.addEventListener("submit", sendManualReply);
}

async function sendManualReply(event) {
  event.preventDefault();
  if (!state.selectedLeadId || state.isSendingReply) return;

  const input = $("#chatReplyText");
  const sendButton = event.submitter || $("#chatReplyForm button[type='submit']");
  const text = input?.value.trim() || "";
  if (!input) return;
  if (!text) return;

  state.isSendingReply = true;
  if (sendButton) {
    sendButton.disabled = true;
    sendButton.dataset.originalHtml = sendButton.innerHTML;
    sendButton.innerHTML = `<i data-lucide="loader-circle"></i>Sending`;
    refreshIcons();
  }

  const optimisticMessage = normalizeMessage({
    id: `optimistic-${Date.now()}`,
    direction: "OUTBOUND",
    sender: "Business",
    text,
    timestamp: new Date().toISOString(),
    status: "SENDING"
  });
  input.value = "";

  if (state.selectedConversation) {
    state.selectedConversation = {
      ...state.selectedConversation,
      messages: normalizeMessages([...state.selectedConversation.messages, optimisticMessage])
    };
    renderThread(state.selectedConversation.messages, "#chatThread", "Send a welcome message to start the WhatsApp thread.", { forceBottom: true });
  }

  try {
    const result = await publicApi(`/leads/${state.selectedLeadId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text })
    });
    if (state.selectedConversation && result?.message) {
      state.selectedConversation = {
        ...state.selectedConversation,
        messages: normalizeMessages([
          ...state.selectedConversation.messages.filter((message) => message.id !== optimisticMessage.id && message.id !== result.message.id),
          result.message
        ])
      };
      renderConversation(state.selectedConversation, { forceBottom: true });
    }
    await loadLeads({ updateOverview: false });
  } catch (error) {
    if (state.selectedConversation) {
      state.selectedConversation = {
        ...state.selectedConversation,
        messages: state.selectedConversation.messages.filter((message) => message.id !== optimisticMessage.id)
      };
      renderThread(state.selectedConversation.messages, "#chatThread", "Send a welcome message to start the WhatsApp thread.", { forceBottom: true });
    }
    input.value = text;
    logDashboardError("Manual reply failed", error);
    showNotice("Message could not be sent. Check WhatsApp settings and try again.", true);
  } finally {
    state.isSendingReply = false;
    if (sendButton) {
      sendButton.disabled = false;
      sendButton.innerHTML = sendButton.dataset.originalHtml || `<i data-lucide="send-horizontal"></i>Send`;
      delete sendButton.dataset.originalHtml;
      refreshIcons();
    }
  }
}

async function resolveHumanAction(leadId) {
  try {
    await publicApi(`/human-action-queue/${leadId}/resolve`, { method: "POST" });
    showNotice("Human attention item resolved");
    await Promise.all([loadOperationalData(), loadLeads()]);
    if (state.selectedLeadId === leadId) await loadConversation(leadId);
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function performOrderAction(orderId, action, button) {
  const originalText = button?.textContent;
  const status = $("#orderActionStatus");
  if (button) {
    button.disabled = true;
    button.textContent = "Sending...";
  }
  if (status) {
    status.textContent = "Sending WhatsApp update...";
    status.classList.remove("hidden");
  }

  try {
    const result = await publicApi(`/orders/${orderId}/action`, {
      method: "POST",
      body: JSON.stringify({ action })
    });
    showNotice("Order update sent on WhatsApp");
    if (state.selectedConversation && result?.message && state.selectedConversation.lead?.id === result.message.leadId) {
      state.selectedConversation = {
        ...state.selectedConversation,
        lead: {
          ...state.selectedConversation.lead,
          orderSummary: result.order
        },
        messages: [...state.selectedConversation.messages.filter((message) => message.id !== result.message.id), result.message]
      };
      renderConversation(state.selectedConversation, { forceBottom: true });
    }
    await Promise.all([loadOperationalData(), loadLeads({ updateOverview: false })]);
    if (state.selectedLeadId) await loadConversation(state.selectedLeadId, { forceBottom: true });
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
    status?.classList.add("hidden");
  }
}

async function startDashboard() {
  const fallbackTimer = window.setTimeout(() => {
    if (!state.overviewLoaded) {
      renderDashboardFallback("Command Center is taking longer than expected. You can keep working while it reconnects.");
      showNotice("Command Center is taking longer than expected. Retrying in the background.", true);
    }
  }, DASHBOARD_START_FALLBACK_MS);
  try {
    await loadSessionAndFeatures();
    bindEvents();
    bindSessionRestoreGuard();
    refreshIcons();
    if (featureEnabledForView("chats")) connectChatEvents();
    const requestedView = requestedViewFromLocation();
    switchView(views[requestedView] ? requestedView : featureEnabledForView("overview") ? "overview" : firstAvailableView());
    startDashboardPolling();
  } catch (error) {
    if (error?.redirecting) return;
    if (error?.companyContextMissing || error?.message === COMPANY_CONTEXT_MISSING_MESSAGE) {
      renderCompanyContextMissing();
      showNotice(COMPANY_CONTEXT_MISSING_MESSAGE, true);
      return;
    }
    if (!state.overviewLoaded) {
      renderDashboardFallback("Command Center could not start. Please refresh or sign in again.");
    }
    showNotice(error.message || "Command Center could not start.", true);
  }

  premiumLibrariesReady.then(() => {
    refreshIcons();
    if (state.latestOverview) renderDerivedOverview();
    runMotion();
  });
}

startDashboard();
