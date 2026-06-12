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
  orderPipeline: {}
};

const views = {
  overview: document.querySelector("#overviewView"),
  chats: document.querySelector("#chatsView"),
  leads: document.querySelector("#leadsView")
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

function messageCountLabel(lead) {
  const count = Number(lead?.messageCount || 0);
  return `${count} msg${count === 1 ? "" : "s"}`;
}

function previewText(value) {
  return String(value || "No messages yet").replace(/\s+/g, " ").trim();
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

async function api(path, options = {}) {
  const response = await fetch(`/admin/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (response.status === 401) {
    window.location.href = "/login";
    return null;
  }

  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong");
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

function captureUiState() {
  return {
    windowScrollY: window.scrollY,
    chatThreadScrollTop: $("#chatThread")?.scrollTop ?? null,
    chatListScrollTop: $("#chatConversationList")?.scrollTop ?? null,
    leadProfileScrollTop: document.querySelector(".lead-profile-panel")?.scrollTop ?? null,
    orderPipelineScrollLeft: $("#orderPipelineBoard")?.scrollLeft ?? null,
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
    const leadProfile = document.querySelector(".lead-profile-panel");
    if (snapshot.leadProfileScrollTop !== null && leadProfile) {
      leadProfile.scrollTop = snapshot.leadProfileScrollTop;
    }
    if (snapshot.orderPipelineScrollLeft !== null && $("#orderPipelineBoard")) {
      $("#orderPipelineBoard").scrollLeft = snapshot.orderPipelineScrollLeft;
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
    const matchesTemperature = forChats || !state.temperatureFilter || lead.temperature === state.temperatureFilter;
    const haystack = `${lead.name} ${lead.source || ""} ${lead.temperatureReason || ""} ${lead.aiInsight || ""} ${lead.lastMessage || ""}`.toLowerCase();
    return matchesTemperature && (!search || haystack.includes(search));
  });
}

function humanActionRow(item) {
  return `
    <article class="human-action-row">
      <button class="conversation-preview-row" data-open-chat="${item.leadId}">
        <span class="lead-avatar">${escapeHtml(item.customerName).slice(0, 1).toUpperCase()}</span>
        <span class="conversation-preview-main">
          <span class="conversation-preview-top">
            <strong>${escapeHtml(item.customerName)}</strong>
            <span class="priority-badge ${String(item.priority || "LOW").toLowerCase()}">${pretty(item.priority || "LOW")}</span>
            <span class="tag ${String(item.temperature).toLowerCase()}">${pretty(item.temperature)}</span>
          </span>
          <span class="conversation-preview-text">${escapeHtml(previewText(item.lastMessage))}</span>
          <span class="conversation-preview-phone">${escapeHtml(item.phone)} - ${escapeHtml(item.reason || "Manual review needed")}</span>
        </span>
        <span class="conversation-preview-meta">
          <time>${relativeTime(item.time)}</time>
          <small>${messageCountLabel(item)}</small>
        </span>
        <i data-lucide="arrow-up-right"></i>
      </button>
      <div class="row-actions">
        <button class="secondary-button" type="button" data-open-chat="${item.leadId}">
          <i data-lucide="messages-square"></i>
          Open Chat
        </button>
        <button class="secondary-button" type="button" data-resolve-human="${item.leadId}">
          <i data-lucide="check-circle-2"></i>
          Mark Resolved
        </button>
      </div>
    </article>
  `;
}

function renderHumanActionQueue() {
  const list = $("#humanActionQueueList");
  if (!list) return;

  list.innerHTML = state.humanActionQueue.length
    ? state.humanActionQueue.map((item) => humanActionRow(item)).join("")
    : emptyState("No chats need manual attention", "Customer conversations that need human review will appear here.");

  list.querySelectorAll("[data-open-chat]").forEach((button) => {
    button.addEventListener("click", () => openLeadChat(button.dataset.openChat));
  });
  list.querySelectorAll("[data-resolve-human]").forEach((button) => {
    button.addEventListener("click", () => resolveHumanAction(button.dataset.resolveHuman));
  });
}

function orderCard(order) {
  return `
    <article class="order-card">
      <div class="order-card-top">
        <div>
          <strong>${escapeHtml(order.customerName)}</strong>
          <small>${escapeHtml(order.phone)}</small>
        </div>
        <span class="status-badge">${formatOrderStatus(order.status)}</span>
      </div>
      <div class="order-fields">
        <span><b>Product</b>${escapeHtml(emptyValue(order.productType))}</span>
        <span><b>Qty</b>${escapeHtml(emptyValue(order.quantity))}</span>
        <span><b>Size</b>${escapeHtml(emptyValue(order.size))}</span>
        <span><b>Color</b>${escapeHtml(emptyValue(order.color))}</span>
        <span><b>Custom</b>${escapeHtml(emptyValue(order.customization))}</span>
        <span><b>Location</b>${escapeHtml(emptyValue(order.deliveryLocation))}</span>
      </div>
      <div class="order-card-footer">
        <span>${confidenceLabel(order.confidenceScore)} confidence</span>
        <button class="ghost-action" type="button" data-open-chat="${order.leadId}">
          <i data-lucide="messages-square"></i>
          Open Chat
        </button>
      </div>
      <div class="row-actions">
        <button class="secondary-button" type="button" data-order-id="${order.id}" data-next-action="CONFIRM">Mark Confirmed</button>
        <button class="secondary-button" type="button" data-order-id="${order.id}" data-next-action="DISPATCH">Mark Dispatched</button>
      </div>
    </article>
  `;
}

function renderOrderPipeline() {
  const board = $("#orderPipelineBoard");
  if (!board) return;

  const stages = [
    "COLLECTING_DETAILS",
    "READY_FOR_REVIEW",
    "QUOTATION_NEEDED",
    "CONFIRMED",
    "READY_FOR_DISPATCH",
    "DISPATCHED"
  ];

  board.innerHTML = stages
    .map((stage) => {
      const orders = state.orderPipeline[stage] || [];
      return `
        <section class="pipeline-column">
          <div class="pipeline-column-heading">
            <strong>${formatOrderStatus(stage)}</strong>
            <span>${orders.length}</span>
          </div>
          <div class="pipeline-column-list">
            ${orders.length ? orders.map(orderCard).join("") : `<div class="empty-pipeline-slot">No orders</div>`}
          </div>
        </section>
      `;
    })
    .join("");

  board.querySelectorAll("[data-open-chat]").forEach((button) => {
    button.addEventListener("click", () => openLeadChat(button.dataset.openChat));
  });
  board.querySelectorAll("[data-order-id][data-next-action]").forEach((button) => {
    button.addEventListener("click", () => performOrderAction(button.dataset.orderId, button.dataset.nextAction, button));
  });
}

function conversationPreviewRow(lead) {
  return `
    <button class="conversation-preview-row" data-open-chat="${lead.id}">
      <span class="lead-avatar">${escapeHtml(lead.name).slice(0, 1).toUpperCase()}</span>
      <span class="conversation-preview-main">
        <span class="conversation-preview-top">
          <strong>${escapeHtml(lead.name)}</strong>
          <span class="tag ${lead.temperature.toLowerCase()}">${pretty(lead.temperature)}</span>
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

function renderConversationIntel(recentLeads = []) {
  renderHumanActionQueue();
}

function renderRecentConversations(recentLeads = []) {
  renderOrderPipeline();
}

function renderDerivedOverview() {
  if (!state.latestOverview) return;

  const { stats, recentLeads } = state.latestOverview;
  const totalMessages = (stats.inboundMessages || 0) + (stats.outboundMessages || 0);
  const total = Math.max(1, stats.totalLeads || 0);

  setText("sidebarSummary", `${stats.hotLeads} hot / ${stats.warmLeads} warm / ${stats.scrapLeads} scrap`);
  const meter = $("#sidebarMeter");
  if (meter) meter.style.width = `${Math.max(8, Math.round((stats.hotLeads / total) * 100))}%`;

  setText("totalLeadTrend", `${totalMessages} msgs`);
  setText("hotLeadTrend", `${Math.round((stats.hotLeads / total) * 100)}% hot`);
  setText("warmLeadTrend", `${Math.round((stats.warmLeads / total) * 100)}% warm`);
  setText("scrapLeadTrend", `${Math.round((stats.scrapLeads / total) * 100)}% scrap`);
  setText("totalLeadInsight", `${totalMessages} tracked messages across the workspace.`);
  setText("hotLeadInsight", `${stats.hotLeads} leads deserve same-day follow-up.`);
  setText("warmLeadInsight", `${stats.warmLeads} accounts need guided nurture.`);
  setText("scrapLeadInsight", `${stats.scrapLeads} records are filtered from priority selling.`);

  renderConversationIntel(recentLeads);
  renderRecentConversations(recentLeads);
}

function renderOverview(data) {
  const stats = data.stats || {
    totalLeads: data.totalLeads || 0,
    hotLeads: data.hotLeads || 0,
    warmLeads: data.warmLeads || 0,
    scrapLeads: data.scrapLeads || 0,
    inboundMessages: data.inboundMessages || 0,
    outboundMessages: data.outboundMessages || 0
  };
  data.stats = stats;
  state.latestOverview = data;
  $("#overviewSkeleton").classList.add("hidden");
  $("#overviewContent").classList.remove("hidden");
  state.overviewLoaded = true;

  animateCounter("totalLeads", stats.totalLeads);
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

  list.innerHTML = leads.length
    ? leads
        .map(
          (lead) => `
            <article class="lead-card ${state.selectedLeadId === lead.id ? "active" : ""}" data-lead-card="${lead.id}">
              <div class="lead-card-top">
                <span class="lead-avatar">${escapeHtml(lead.name).slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>${escapeHtml(lead.name)}</strong>
                  <small>${pretty(lead.status)} - ${escapeHtml(lead.source || "WhatsApp")}</small>
                </div>
                <span class="tag ${lead.temperature.toLowerCase()}">${pretty(lead.temperature)}</span>
              </div>
              <div class="score-row">
                <span>Lead score</span>
                <div class="score-track"><i style="width:${scoreForLead(lead)}%"></i></div>
                <strong>${scoreForLead(lead)}</strong>
              </div>
              <p>${escapeHtml(lead.aiInsight || lead.temperatureBasis || "No AI insight captured yet")}</p>
              <div class="lead-card-actions">
                <span>${lead.messageCount || 0} messages - ${relativeTime(lead.updatedAt)}</span>
                <button class="ghost-action" type="button" data-open-chat="${lead.id}">
                  <i data-lucide="messages-square"></i>
                  Open chat
                </button>
              </div>
            </article>
          `
        )
        .join("")
    : emptyState("No leads match this view", "Adjust search, clear filters, or import a new Sheet segment.");

  list.querySelectorAll("[data-lead-card]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("[data-open-chat]")) return;
      loadConversation(card.dataset.leadCard);
    });
  });
  list.querySelectorAll("[data-open-chat]").forEach((button) => {
    button.addEventListener("click", () => openLeadChat(button.dataset.openChat));
  });

  refreshIcons();
  runMotion(".lead-card");
}

function renderChatList() {
  const list = $("#chatConversationList");
  if (!list) return;
  const leads = getFilteredLeads(true).sort((a, b) => scoreForLead(b) - scoreForLead(a));

  list.innerHTML = leads.length
    ? leads
        .map(
          (lead) => `
            <button class="chat-list-row ${state.selectedLeadId === lead.id ? "active" : ""}" data-chat-lead="${lead.id}">
              <span class="lead-avatar">${escapeHtml(lead.name).slice(0, 1).toUpperCase()}</span>
              <span class="chat-list-main">
                <span class="chat-list-top">
                  <strong>${escapeHtml(lead.name)}</strong>
                  <span class="tag ${lead.temperature.toLowerCase()}">${pretty(lead.temperature)}</span>
                </span>
                <small>${escapeHtml(previewText(lead.lastMessage))}</small>
              </span>
              <span class="chat-list-meta">
                <time>${relativeTime(lead.updatedAt)}</time>
                <small>${messageCountLabel(lead)}</small>
              </span>
            </button>
          `
        )
        .join("")
    : emptyState("No chats found", "Try a different search or import leads to start conversations.");

  list.querySelectorAll("[data-chat-lead]").forEach((button) => {
    button.addEventListener("click", () => loadConversation(button.dataset.chatLead));
  });
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
    profileStatus.textContent = lead ? pretty(lead.temperature) : "Not selected";
    profileStatus.className = `tag ${lead ? lead.temperature.toLowerCase() : "neutral"}`;
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
  thread.classList.remove("empty-state");
  thread.innerHTML = messages.length
    ? messages
        .map(
          (message) => `
            <div class="bubble ${message.direction.toLowerCase()}">
              <span>${escapeHtml(message.content)}</span>
              <small>${pretty(message.status)} - ${formatDate(message.createdAt)}</small>
            </div>
          `
        )
        .join("")
    : emptyState("No conversation yet", emptyCopy);
  if (shouldStickToBottom) {
    thread.scrollTop = thread.scrollHeight;
    $("#newMessageBtn")?.classList.add("hidden");
  } else {
    thread.scrollTop = previousScrollTop;
    $("#newMessageBtn")?.classList.remove("hidden");
  }
}

function renderConversation(data, options = {}) {
  state.selectedLeadId = data.lead.id;
  state.selectedConversation = data;
  const leadFromList = { ...(state.leads.find((lead) => lead.id === data.lead.id) || {}), ...data.lead };
  const meta = `${pretty(data.lead.status)} - ${data.lead.messageCount} messages - ${pretty(data.lead.temperature)}`;

  setText("chatLeadName", data.lead.name);
  setText("chatLeadMeta", meta);
  $("#chatReplyForm")?.classList.remove("hidden");
  renderThread(data.messages, "#chatThread", "Send a welcome message to start the WhatsApp thread.", options);
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
    state.humanActionQueue = data.humanActionQueue || data.items || [];
    state.orderPipeline = data.orderPipeline || data.pipeline || {};
    if (recentLeads.length) {
      state.leads = recentLeads;
      renderLeadCards();
      renderChatList();
    }
    renderHumanActionQueue();
    renderOrderPipeline();
    renderOverview(data);
  } catch (error) {
    logDashboardError("Overview load failed", error);
    showNotice("Dashboard data could not load. Check browser console for details.", true);
  }
}

async function loadLeads(options = {}) {
  const updateOverview = options.updateOverview ?? state.currentView === "overview";
  const data = await api(
    `/leads${buildQuery({
      search: state.leadSearch,
      temperature: state.temperatureFilter
    })}`
  );
  state.leads = data?.leads || [];
  renderLeadCards();
  renderChatList();
  if (updateOverview) renderDerivedOverview();
}

async function loadOperationalData() {
  const [queueData, pipelineData] = await Promise.all([
    api("/human-action-queue"),
    api("/order-pipeline")
  ]);
  state.humanActionQueue = queueData?.items || [];
  state.orderPipeline = pipelineData?.pipeline || {};
  renderHumanActionQueue();
  renderOrderPipeline();
  refreshIcons();
}

async function loadConversation(leadId, options = {}) {
  const data = await api(`/leads/${leadId}/conversation`);
  if (data) renderConversation(data, options);
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
  if (!window.EventSource) return;

  const events = new EventSource("/admin/api/events");
  const handleEvent = (event) => {
    const data = JSON.parse(event.data);
    if (!data.leadId) return;

    const thread = $("#chatThread");
    const nearBottom = isNearBottom(thread);
    refreshChatStateForLead(data.leadId, { forceBottom: nearBottom }).catch((error) => showNotice(error.message, true));

    if (data.type === "order.updated") {
      loadOperationalData().catch((error) => showNotice(error.message, true));
    }
  };

  events.addEventListener("message.created", handleEvent);
  events.addEventListener("message.status", handleEvent);
  events.addEventListener("order.updated", handleEvent);
  events.addEventListener("lead.updated", handleEvent);
  events.onerror = () => {
    console.warn("Chat event stream disconnected. Browser will retry automatically.");
  };
}

function setTemperatureFilter(value) {
  state.temperatureFilter = value || "";
  const select = $("#temperatureFilter");
  if (select) select.value = state.temperatureFilter;
  document.querySelectorAll("[data-temperature-tab]").forEach((tab) => {
    tab.classList.toggle("active", (tab.dataset.temperatureTab || "") === state.temperatureFilter);
  });
}

function switchView(name) {
  state.currentView = name;
  document.body.classList.toggle("chat-mode", name === "chats");
  Object.entries(views).forEach(([key, element]) => {
    element.classList.toggle("active-view", key === name);
  });
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  runMotion(name === "overview" ? ".premium-card, .metric-tile" : ".premium-card, .lead-card, .chat-list-row");
  if (name === "overview") loadOverview();
  if (name === "leads" || name === "chats") loadLeads().catch((error) => showNotice(error.message, true));
}

async function refreshCurrentView() {
  if (state.isRefreshing) return;
  state.isRefreshing = true;
  const snapshot = captureUiState();
  try {
    await Promise.all([loadOverview(), loadLeads(), loadOperationalData()]);
    if (state.selectedLeadId) await loadConversation(state.selectedLeadId);
  } finally {
    state.isRefreshing = false;
    restoreUiState(snapshot);
  }
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
      const result = await api("/actions/import-leads", { method: "POST" });
      showNotice(`Imported ${result.imported} leads`);
      await refreshCurrentView();
    } catch (error) {
      showNotice(error.message, true);
    }
  });

  $("#sendInitialBtn")?.addEventListener("click", async () => {
    try {
      const result = await api("/actions/send-initial", { method: "POST" });
      showNotice(`Sent ${result.sent} welcome messages. ${result.failed} failed.`);
      await refreshCurrentView();
    } catch (error) {
      showNotice(error.message, true);
    }
  });

  $("#humanTakeoverBtn")?.addEventListener("click", () => {
    showNotice("Human takeover enabled for this thread. AI remains in assist mode.");
    $("#aiStatusIndicator").innerHTML = `<i data-lucide="user-round-check"></i>Human in control`;
    refreshIcons();
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

  const tempMessage = {
    id: `temp-${Date.now()}`,
    direction: "OUTBOUND",
    type: "TEXT",
    content: text,
    status: "PENDING",
    createdAt: new Date().toISOString()
  };
  const previousConversation = state.selectedConversation;
  if (previousConversation) {
    state.selectedConversation = {
      ...previousConversation,
      messages: [...previousConversation.messages, tempMessage]
    };
    renderConversation(state.selectedConversation, { forceBottom: true });
  }
  input.value = "";

  try {
    const result = await api(`/leads/${state.selectedLeadId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text })
    });
    showNotice("WhatsApp reply sent");
    if (state.selectedConversation && result?.message) {
      state.selectedConversation = {
        ...state.selectedConversation,
        messages: state.selectedConversation.messages.map((message) => (message.id === tempMessage.id ? result.message : message))
      };
      renderConversation(state.selectedConversation, { forceBottom: true });
    }
    await refreshChatStateForLead(state.selectedLeadId, { forceBottom: true });
  } catch (error) {
    if (previousConversation) {
      state.selectedConversation = previousConversation;
      renderConversation(previousConversation, { forceBottom: true });
      input.value = text;
    }
    showNotice(error.message, true);
  }
}

async function resolveHumanAction(leadId) {
  try {
    await api(`/human-action-queue/${leadId}/resolve`, { method: "POST" });
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
    const result = await api(`/orders/${orderId}/action`, {
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

premiumLibrariesReady.then(() => {
  refreshIcons();
  if (state.latestOverview) renderDerivedOverview();
  runMotion();
});
