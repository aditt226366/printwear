const state = {
  leads: [],
  selectedLeadId: null,
  selectedConversation: null,
  leadSearch: "",
  chatSearch: "",
  temperatureFilter: "",
  currentView: "overview",
  overviewLoaded: false,
  latestOverview: null,
  isRefreshing: false,
  humanActionQueue: [],
  orderPipeline: {},
  dashboardLoaded: false,
  isPolling: false
};

const DASHBOARD_POLL_INTERVAL_MS = 4000;

const views = {
  overview: document.querySelector("#overviewView"),
  chats: document.querySelector("#chatsView"),
  leads: document.querySelector("#leadsView"),
  orders: document.querySelector("#ordersView"),
  human: document.querySelector("#humanView"),
  reports: document.querySelector("#reportsView"),
  settings: document.querySelector("#settingsView")
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

function normalizeMessage(message) {
  const direction = String(message?.direction || "INBOUND").toUpperCase();
  const text = message?.text ?? message?.content ?? "";

  return {
    id: String(message?.id || `${direction}-${messageTimestamp(message)}-${text}`),
    timestamp: messageTimestamp(message),
    createdAt: messageTimestamp(message),
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
  notice.textContent = message;
  notice.classList.toggle("error", isError);
  notice.classList.remove("hidden");
  window.setTimeout(() => notice.classList.add("hidden"), 4600);
}

function logDashboardError(context, error, details = {}) {
  console.error(`[Dashboard] ${context}`, {
    error,
    message: error instanceof Error ? error.message : String(error),
    ...details
  });
}

async function publicApi(path, options = {}) {
  const response = await fetch(`/api${path}`, {
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
    if (response.status === 404) throw new Error(errorText || "That record could not be found.");
    if (response.status === 401 || response.status === 403) throw new Error("Your session is not authorized for this action.");
    if (errorText && !/internal server error/i.test(errorText)) {
      throw new Error(details && !/internal server error/i.test(details) ? `${errorText}: ${details}` : errorText);
    }
    throw new Error("Something went wrong while contacting the server. Please try again.");
  }
  return data;
}

async function dashboardApi() {
  const response = await fetch("/api/dashboard", {
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
      body: text
    });
    throw new Error("Dashboard API returned invalid JSON");
  }

  if (!response.ok) {
    logDashboardError("/api/dashboard request failed", new Error(data.error || response.statusText), {
      status: response.status,
      response: data
    });
    throw new Error("Dashboard data could not load");
  }

  return data;
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
  if (element) element.textContent = value;
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

function renderKeyedChildren(container, items, keyFn, renderFn, emptyHtml) {
  if (!container) return;
  const scrollTop = container.scrollTop;

  if (!items.length) {
    const nextHtml = emptyHtml.trim();
    if (container.dataset.emptyState !== "true" || container.innerHTML.trim() !== nextHtml) {
      container.innerHTML = nextHtml;
    }
    container.dataset.emptyState = "true";
    return;
  }

  if (container.dataset.emptyState === "true") {
    container.innerHTML = "";
  }
  container.dataset.emptyState = "false";

  const existing = new Map(
    [...container.children]
      .filter((child) => child.dataset?.key)
      .map((child) => [child.dataset.key, child])
  );
  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    const key = String(keyFn(item));
    const fresh = htmlToElement(renderFn(item));
    if (!fresh) return;
    fresh.dataset.key = key;
    const node = existing.get(key);
    if (node) {
      syncElement(node, fresh);
      fragment.appendChild(node);
    } else {
      fragment.appendChild(fresh);
    }
  });

  container.replaceChildren(fragment);
  container.scrollTop = scrollTop;
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

function runMotion(selector = ".premium-card, .metric-tile, .lead-card") {
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
    { key: "pending", label: "Pending Takeover", value: stats.pending, icon: "user-round-check", accent: "purple" },
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
      <button class="secondary-button compact-action" type="button" data-open-chat="${item.leadId}">
        <i data-lucide="messages-square"></i>
        Open Chat
      </button>
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

  list.innerHTML = recent.length
    ? recent.map(conversationPreviewRow).join("")
    : emptyState("No recent conversations", "Recent WhatsApp threads will appear here.");

  list.querySelectorAll("[data-open-chat]").forEach((button) => {
    button.addEventListener("click", () => openLeadChat(button.dataset.openChat));
  });
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
  chart.innerHTML = `
    <svg viewBox="0 0 100 100" role="img" aria-label="Lead growth trend">
      <defs><linearGradient id="leadGlow" x1="0" x2="1"><stop stop-color="#6d5dfc"/><stop offset="1" stop-color="#bb7cff"/></linearGradient></defs>
      <polyline points="${points}" fill="none" stroke="url(#leadGlow)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>
      ${values
        .map((value, index) => `<circle cx="${12 + index * 28}" cy="${86 - Math.round((value / max) * 62)}" r="3.5"></circle>`)
        .join("")}
    </svg>
    <div class="chart-caption"><span>Scrap</span><span>Warm</span><span>Hot</span><span>Total</span></div>
  `;
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
  target.innerHTML = `
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
  `;
}

function renderResponsePerformance(stats = {}) {
  const target = $("#responsePerformance");
  if (!target) return;
  const inbound = Number(stats.inboundMessages || 0);
  const outbound = Number(stats.outboundMessages || 0);
  const replyRate = inbound ? Math.min(100, Math.round((outbound / inbound) * 100)) : 0;
  const humanPressure = Math.min(100, Math.round((humanQueueItems().length / Math.max(1, Number(stats.totalLeads || 0))) * 100));
  target.innerHTML = `
    <div class="performance-ring" style="--value:${replyRate}">
      <strong>${replyRate}%</strong>
      <span>Reply coverage</span>
    </div>
    <div class="performance-lines">
      <div><span>Human pressure</span><b>${humanPressure}%</b><i><em style="width:${humanPressure}%"></em></i></div>
      <div><span>Automation coverage</span><b>${Math.max(0, 100 - humanPressure)}%</b><i><em style="width:${Math.max(0, 100 - humanPressure)}%"></em></i></div>
    </div>
  `;
}

function renderAnalytics(stats = {}) {
  renderLeadGrowthChart(stats);
  renderTemperatureDistribution(stats);
  renderResponsePerformance(stats);
  const reportsLeadMix = $("#reportsLeadMix");
  const reportsResponse = $("#reportsResponse");
  if (reportsLeadMix) reportsLeadMix.innerHTML = $("#temperatureDistribution")?.innerHTML || "";
  if (reportsResponse) reportsResponse.innerHTML = $("#responsePerformance")?.innerHTML || "";
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
  refreshIcons();
}

function renderOrderSummaryCards() {
  const target = $("#orderDeskSummaryCards");
  if (!target) return;
  const stats = orderDeskStats();
  const cards = [
    { key: "total", label: "Total Orders", value: stats.total, icon: "package", accent: "purple" },
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
}

function renderConversationIntel(recentLeads = []) {
  renderHumanQueueViews();
}

function renderRecentConversations(recentLeads = []) {
  renderRecentConversationList(recentLeads);
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
    `Live WhatsApp sales, orders, and human takeover intelligence. ${activeChats} active chat${activeChats === 1 ? "" : "s"}, ${ordersDone} order${ordersDone === 1 ? "" : "s"} done.`
  );
  setText("hotLeadTrend", `${Math.round((stats.hotLeads / total) * 100)}% hot`);
  setText("warmLeadTrend", `${Math.round((stats.warmLeads / total) * 100)}% warm`);
  setText("scrapLeadTrend", `${Math.round((stats.scrapLeads / total) * 100)}% scrap`);
  setText("humanTakeoverTrend", humanCount ? `${humanCount} waiting` : "Clear");
  setText("ordersDoneTrend", ordersDone ? `${ordersDone} ready` : "No completed orders");
  animateCounter("hotLeads", stats.hotLeads);
  animateCounter("warmLeads", stats.warmLeads);
  animateCounter("scrapLeads", stats.scrapLeads);
  animateCounter("humanQueueCount", humanCount);
  animateCounter("ordersDone", ordersDone);
  setText("hotLeadInsight", `${stats.hotLeads} lead${stats.hotLeads === 1 ? "" : "s"} with 6+ messages deserve same-day follow-up.`);
  setText("warmLeadInsight", `${stats.warmLeads} account${stats.warmLeads === 1 ? "" : "s"} with 2-5 messages need nurture.`);
  setText("scrapLeadInsight", `${stats.scrapLeads} record${stats.scrapLeads === 1 ? "" : "s"} under 2 messages stay low priority.`);
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
  refreshIcons();
  runMotion();
}

function emptyState(title, text) {
  return `<article class="empty-card"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></article>`;
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
  const leads = getFilteredLeads(true).sort(
    (a, b) => new Date(b.lastMessageAt || b.updatedAt).getTime() - new Date(a.lastMessageAt || a.updatedAt).getTime()
  );

  renderKeyedChildren(
    list,
    leads,
    (lead) => lead.id,
    (lead) => {
      const unreadCount = Number(lead.unreadCount || 0);
      const temperature = leadTemperature(lead);
      return `
            <button class="chat-list-row ${state.selectedLeadId === lead.id ? "active" : ""}" data-chat-lead="${lead.id}">
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
    emptyState("No chats found", "Try a different search or import leads to start conversations.")
  );

  bindDelegatedClick(list, "chatLeadSelect", "[data-chat-lead]", (button) => loadConversation(button.dataset.chatLead));
}

function renderLeadProfile(lead) {
  const letter = lead?.name ? lead.name.slice(0, 1).toUpperCase() : "PW";
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
  card.innerHTML = `
    <span>Requires human: <strong>${requiresHuman ? "Yes" : "No"}</strong></span>
    <span>Priority: <strong>${escapeHtml(lead?.humanPriority ? pretty(lead.humanPriority) : "--")}</strong></span>
    <span>Reason: <strong>${escapeHtml(lead?.humanReason || "--")}</strong></span>
  `;

  const button = $("#profileResolveHumanBtn");
  if (button) button.classList.toggle("hidden", !requiresHuman);
}

function renderOrderSummaryProfile(order) {
  const card = $("#orderSummaryCard");
  if (!card) return;

  card.innerHTML = `
    <span>Product: <strong>${escapeHtml(emptyValue(order?.productType))}</strong></span>
    <span>Quantity: <strong>${escapeHtml(emptyValue(order?.quantity))}</strong></span>
    <span>Size: <strong>${escapeHtml(emptyValue(order?.size))}</strong></span>
    <span>Color: <strong>${escapeHtml(emptyValue(order?.color))}</strong></span>
    <span>GSM: <strong>${escapeHtml(emptyValue(order?.gsm))}</strong></span>
    <span>Customization: <strong>${escapeHtml(emptyValue(order?.customization))}</strong></span>
    <span>Location: <strong>${escapeHtml(emptyValue(order?.deliveryLocation))}</strong></span>
    <span>Status: <strong>${escapeHtml(order ? formatOrderStatus(order.status) : "--")}</strong></span>
    <span>Confidence: <strong>${order ? confidenceLabel(order.confidenceScore) : "--"}</strong></span>
  `;

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
    const data = await dashboardApi();
    const recentLeads = data.recentLeads || data.recentConversations || [];
    data.recentLeads = recentLeads;
    state.dashboardLoaded = true;
    state.humanActionQueue = data.humanActionQueue || data.items || [];
    state.orderPipeline = data.orderPipeline || data.pipeline || {};
    state.leads = state.leads.length ? mergeLeads(state.leads, recentLeads) : recentLeads;
    renderLeadCards();
    renderChatList();
    renderHumanActionQueue();
    renderOverview(data);
  } catch (error) {
    logDashboardError("Overview load failed", error);
    showNotice("Dashboard data could not load. Check browser console for details.", true);
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
    showNotice(error.message, true);
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
      logDashboardError("Invalid chat event payload", error, { payload: event.data });
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
  }

  events.addEventListener("message.created", handleChatEvent);
  events.addEventListener("lead.updated", handleChatEvent);
  events.addEventListener("message.status", handleChatEvent);
  events.addEventListener("order.updated", handleChatEvent);

  events.addEventListener("error", (error) => {
    logDashboardError("Chat event stream error", error);
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
  state.currentView = name;
  document.body.classList.toggle("chat-mode", name === "chats");
  Object.entries(views).forEach(([key, element]) => {
    element.classList.toggle("active-view", key === name);
  });
  document.querySelectorAll(".nav-item").forEach((button) => {
    const isSegment = button.dataset.temperatureTab !== undefined;
    const isSelectedSegment = name === "leads" && isSegment && (button.dataset.temperatureTab || "") === state.temperatureFilter;
    const isPrimaryView = !isSegment && button.dataset.view === name;
    button.classList.toggle("active", isPrimaryView || isSelectedSegment);
  });
  runMotion(name === "overview" ? ".premium-card, .metric-tile" : ".premium-card, .lead-card, .chat-list-row");
  if (name === "overview") loadOverview();
  if (name === "leads" || name === "chats") loadLeads().catch((error) => showNotice(error.message, true));
  if (name === "orders") loadOrderData().catch((error) => showNotice(error.message, true));
  if (name === "human") loadOperationalData().catch((error) => showNotice(error.message, true));
  if (name === "reports") {
    if (state.latestOverview) renderAnalytics(state.latestOverview.stats || {});
    else loadOverview().catch((error) => showNotice(error.message, true));
  }
}

async function refreshCurrentView() {
  if (state.isRefreshing) return;
  state.isRefreshing = true;
  const snapshot = captureUiState();
  try {
    await Promise.all([loadOverview(), loadLeads(), loadOperationalData()]);
    if (state.selectedLeadId) await loadConversation(state.selectedLeadId, { forceBottom: isNearBottom($("#chatThread")) });
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
    await loadLeads({ updateOverview: false });
    if (selectedLeadId) {
      await loadConversation(selectedLeadId, { forceBottom });
    }
    if (state.currentView === "overview" || state.currentView === "reports") {
      const data = await dashboardApi();
      state.latestOverview = data;
      state.humanActionQueue = data.humanActionQueue || data.items || [];
      state.orderPipeline = data.orderPipeline || data.pipeline || {};
      renderDerivedOverview();
    } else if (state.currentView === "orders") {
      await loadOrderData();
    } else {
      await loadOperationalData();
    }
  } catch (error) {
    logDashboardError("Dashboard polling failed", error);
  } finally {
    state.isPolling = false;
  }
}

function startDashboardPolling() {
  window.setInterval(() => {
    pollDashboardData();
  }, DASHBOARD_POLL_INTERVAL_MS);
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
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

  $("#importLeadsBtn")?.addEventListener("click", async () => {
    try {
      const result = await publicApi("/leads/import", { method: "POST" });
      showNotice(`Imported ${result.imported} leads`);
      await refreshCurrentView();
    } catch (error) {
      showNotice(error.message, true);
    }
  });

  $("#sendInitialBtn")?.addEventListener("click", async () => {
    try {
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
      $("#aiStatusIndicator").innerHTML = `<i data-lucide="user-round-check"></i>Human in control`;
      renderHumanActionQueue();
      renderLeadProfile(state.selectedConversation?.lead);
      refreshIcons();
    } catch (error) {
      logDashboardError("Human takeover request failed", error);
      showNotice("Could not enable human takeover. Please try again.", true);
    }
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
  if (!state.selectedLeadId) return;

  const input = $("#chatReplyText");
  const text = input.value.trim();
  if (!text) return;

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

bindEvents();
refreshIcons();
connectChatEvents();
loadOverview();
startDashboardPolling();

premiumLibrariesReady.then(() => {
  refreshIcons();
  if (state.latestOverview) renderDerivedOverview();
  runMotion();
});
