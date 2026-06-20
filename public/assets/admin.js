const adminState = {
  companies: [],
  users: [],
  features: [],
  integration: null,
  integrationCompanies: [],
  integrations: [],
  selectedIntegrationCompany: null,
  integrationDrawerTab: "integrations",
  integrationTests: {},
  diagnostics: null,
  billing: { summary: {}, logs: [] },
  currentView: "overview",
  userFilters: {
    search: "",
    companyId: "",
    status: "",
    role: ""
  }
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

function $(selector) {
  return document.querySelector(selector);
}

function setText(id, value) {
  const element = document.querySelector(`#${id}`);
  if (element) element.textContent = value;
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
  if (!value) return "--";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function initials(value) {
  return String(value || "User")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function showNotice(message, isError = false) {
  const notice = $("#adminNotice");
  if (!notice) return;
  notice.textContent = message;
  notice.classList.toggle("error", isError);
  notice.classList.remove("hidden");
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => notice.classList.add("hidden"), 4500);
}

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const body = options.body && !isFormData && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body;
  const response = await fetch(`/api${path}`, {
    ...options,
    body,
    headers: isFormData
      ? { ...(options.headers || {}) }
      : {
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const fieldErrors = data.fieldErrors || data.details?.fieldErrors || {};
    const error = new Error(data.error || data.message || Object.values(fieldErrors)[0] || "Request failed");
    error.fieldErrors = fieldErrors;
    error.response = data;
    throw error;
  }
  return data;
}

const fieldSelectors = {
  companyName: "#companyName",
  slug: "#companySlug",
  companyId: "#userCompany",
  name: "#userName",
  username: "#userUsername",
  password: "#userPassword",
  confirmPassword: "#userConfirmPassword",
  status: "#userStatus"
};

function clearFormErrors(form) {
  form?.querySelectorAll(".field-error").forEach((error) => error.remove());
  form?.querySelectorAll(".is-invalid").forEach((field) => {
    field.classList.remove("is-invalid");
    field.removeAttribute("aria-invalid");
    field.removeAttribute("aria-describedby");
  });
}

function setFieldError(form, field, message) {
  const selector = field === "status" && form?.id === "companyForm" ? "#companyStatus" : fieldSelectors[field];
  const input = selector ? form?.querySelector(selector) : null;
  if (!input || !message) return false;
  const id = `${input.id}Error`;
  const error = document.createElement("small");
  error.id = id;
  error.className = "field-error";
  error.textContent = message;
  input.classList.add("is-invalid");
  input.setAttribute("aria-invalid", "true");
  input.setAttribute("aria-describedby", id);
  input.closest("label")?.appendChild(error);
  return true;
}

function showFormError(form, error) {
  clearFormErrors(form);
  const fieldErrors = error.fieldErrors || {};
  Object.entries(fieldErrors).forEach(([field, message]) => setFieldError(form, field, message));
  showNotice(error.message || Object.values(fieldErrors)[0] || "Please check the highlighted fields.", true);
}

function clearClientSessionState() {
  adminState.companies = [];
  adminState.users = [];
  adminState.features = [];
  adminState.integration = null;
  adminState.integrationCompanies = [];
  adminState.integrations = [];
  adminState.selectedIntegrationCompany = null;
  adminState.diagnostics = null;
  adminState.billing = { summary: {}, logs: [] };
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

function refreshIcons() {
  window.lucide?.createIcons?.();
}

async function loadLucide() {
  try {
    const lucideModule = await import("https://esm.sh/lucide@0.468.0");
    window.lucide = { createIcons: (options = {}) => lucideModule.createIcons({ icons: lucideModule.icons, ...options }) };
    refreshIcons();
  } catch {
    // Icons are decorative; keep admin usable if CDN fails.
  }
}

function switchAdminView(view) {
  adminState.currentView = view;
  const nextPath = view === "integrations" ? "/admin/integrations" : "/admin";
  if (window.location.pathname !== nextPath) {
    window.history.pushState({}, "", nextPath);
  }
  document.querySelectorAll("[data-admin-view]").forEach((button) => button.classList.toggle("active", button.dataset.adminView === view));
  document.querySelectorAll("main > .view").forEach((section) => section.classList.remove("active-view"));
  $(`#admin${view[0].toUpperCase()}${view.slice(1)}View`)?.classList.add("active-view");
  if (view === "features") loadFeatures().catch((error) => showNotice(error.message, true));
  if (view === "integrations") loadIntegrationCompanies().catch((error) => showNotice(error.message, true));
  if (view === "billing") loadBilling().catch((error) => showNotice(error.message, true));
  if (view === "diagnostics") loadDiagnostics().catch((error) => showNotice(error.message, true));
}

function fillCompanySelects(selectedUserCompanyId = "") {
  const options = adminState.companies.map((company) => `<option value="${escapeHtml(company.id)}">${escapeHtml(company.name)}</option>`).join("");
  ["userCompany", "featureCompanySelect", "billingCompanySelect", "userCompanyFilter"].forEach((id) => {
    const select = $(`#${id}`);
    if (!select) return;
    const current = select.value;
    select.innerHTML = ["billingCompanySelect", "userCompanyFilter"].includes(id) ? `<option value="">All accounts</option>${options}` : options;
    if (current) select.value = current;
  });
  if (selectedUserCompanyId && $("#userCompany")) {
    $("#userCompany").value = selectedUserCompanyId;
  }
}

function upsertCompany(company) {
  if (!company?.id) return;
  adminState.companies = [company, ...adminState.companies.filter((item) => item.id !== company.id)];
  renderCompanies();
}

async function loadCompanies(selectedUserCompanyId = "") {
  const data = await api("/admin/companies");
  adminState.companies = data.companies || [];
  fillCompanySelects(selectedUserCompanyId);
  renderCompanies();
}

function renderCompanies() {
  const table = $("#adminCompaniesTable");
  setText("adminCompanyCount", adminState.companies.length);
  if (!table) return;
  if (!adminState.companies.length) {
    table.innerHTML = `<div class="empty-state"><strong>No accounts yet.</strong><span>Add an account to provision access, entitlements, connections, and usage tracking.</span></div>`;
    return;
  }
  table.innerHTML = `
    <div class="data-row admin-accounts-head">
      <span>Account</span><span>Slug</span><span>Status</span><span>Created</span>
    </div>
    ${adminState.companies.map((company) => `
      <div class="data-row admin-accounts-row">
        <span class="user-cell">
          <i>${escapeHtml(initials(company.name))}</i>
          <span><strong>${escapeHtml(company.name)}</strong><small>${escapeHtml(company.businessType || "Tenant account")}</small></span>
        </span>
        <span>${escapeHtml(company.slug || "--")}</span>
        <span><mark class="${company.status === "ACTIVE" ? "green" : "red"}">${escapeHtml(pretty(company.status))}</mark></span>
        <span>${formatDate(company.createdAt)}</span>
      </div>
    `).join("")}
  `;
  refreshIcons();
}

async function loadUsers() {
  const data = await api("/admin/users");
  adminState.users = data.users || [];
  renderUsers();
}

async function createUserFromForm(form) {
  if (!form || form.dataset.submitting === "true") return;
  const button = form.querySelector("button[type='submit']");
  const previousHtml = button?.innerHTML;
  clearFormErrors(form);
  form.dataset.submitting = "true";
  if (button) {
    button.disabled = true;
    button.innerHTML = `<i data-lucide="loader-circle"></i>Adding member`;
    refreshIcons();
  }
  try {
    await api("/admin/users", {
      method: "POST",
      body: JSON.stringify({
        companyId: $("#userCompany").value,
        name: $("#userName").value,
        username: $("#userUsername").value,
        password: $("#userPassword").value,
        confirmPassword: $("#userConfirmPassword").value,
        status: $("#userStatus").value
      })
    });
    clearFormErrors(form);
    form.reset();
    showNotice("Member added.");
    await loadUsers();
  } catch (error) {
    showFormError(form, error);
  } finally {
    delete form.dataset.submitting;
    if (button) {
      button.disabled = false;
      button.innerHTML = previousHtml || `<i data-lucide="user-plus"></i>Add member`;
      refreshIcons();
    }
  }
}

function filteredUsers() {
  const search = adminState.userFilters.search.toLowerCase().trim();
  return adminState.users.filter((user) => {
    const companyName = user.company?.name || "Platform";
    const searchable = `${user.name} ${user.username} ${companyName} ${user.role} ${user.status}`.toLowerCase();
    const matchesSearch = !search || searchable.includes(search);
    const matchesCompany = !adminState.userFilters.companyId || user.companyId === adminState.userFilters.companyId;
    const matchesStatus = !adminState.userFilters.status || user.status === adminState.userFilters.status;
    const matchesRole = !adminState.userFilters.role || user.role === adminState.userFilters.role;
    return matchesSearch && matchesCompany && matchesStatus && matchesRole;
  });
}

function renderUsers() {
  const table = $("#adminUsersTable");
  setText("adminUserCount", adminState.users.length);
  if (!table) return;
  if (!adminState.users.length) {
    table.innerHTML = `<div class="empty-state"><strong>No members yet.</strong><span>Add an account and member to begin.</span></div>`;
    return;
  }
  const users = filteredUsers();
  if (!users.length) {
    table.innerHTML = `<div class="empty-state"><strong>No members match these filters.</strong><span>Adjust search, account, role, or status to see more access records.</span></div>`;
    return;
  }
  table.innerHTML = `
    <div class="data-row admin-users-head">
      <span>Member</span><span>Account</span><span>Role</span><span>Status</span><span>Last login</span><span>Created</span><span>Actions</span>
    </div>
    ${users.map((user) => `
      <div class="data-row admin-users-row" data-user-id="${escapeHtml(user.id)}">
        <span class="user-cell">
          <i>${escapeHtml(initials(user.name))}</i>
          <span><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.username)}</small></span>
        </span>
        <span><mark class="neutral company-badge" title="${escapeHtml(user.company?.name || "Platform")}">${escapeHtml(user.company?.name || "Platform")}</mark></span>
        <span><mark class="${user.role === "ADMIN" ? "green" : "neutral"}">${escapeHtml(pretty(user.role))}</mark></span>
        <span><mark class="${user.status === "ACTIVE" ? "green" : "red"}">${escapeHtml(pretty(user.status))}</mark></span>
        <span>${formatDate(user.lastLoginAt)}</span>
        <span>${formatDate(user.createdAt)}</span>
        <span class="row-actions">
          <button class="secondary-button compact-admin-action" type="button" data-user-reset="${escapeHtml(user.id)}">Reset</button>
          ${user.role === "USER" ? `<button class="secondary-button compact-admin-action" type="button" data-user-status="${escapeHtml(user.id)}">${user.status === "ACTIVE" ? "Suspend" : "Restore"}</button>` : ""}
        </span>
      </div>
    `).join("")}
  `;
  refreshIcons();
}

async function loadIntegrationCompanies() {
  const data = await api("/admin/integrations/companies");
  adminState.integrationCompanies = data.companies || [];
  renderIntegrationCompanies();
}

function renderIntegrationCompanies() {
  const target = $("#integrationCompanyCards");
  if (!target) return;

  if (!adminState.integrationCompanies.length) {
    target.innerHTML = `<div class="empty-state"><strong>No companies yet.</strong><span>Add a company before configuring integration credentials.</span></div>`;
    return;
  }

  target.innerHTML = adminState.integrationCompanies.map((company, index) => {
    const owner = company.owner || {};
    const ownerLabel = owner.email || owner.username || "No owner assigned";
    const statusLabel = company.status === "ACTIVE" ? "ACTIVE" : "DEACTIVATED";
    const total = company.totalIntegrationCount || 6;
    const connected = company.connectedIntegrationCount || 0;
    const errors = company.errorIntegrationCount || 0;
    return `
      <article class="integration-company-card" data-manage-integrations="${escapeHtml(company.id)}" style="--card-index:${index}">
        <div class="integration-company-card-head">
          <span class="integration-company-icon">${escapeHtml(initials(company.name))}</span>
          <div>
            <strong>${escapeHtml(company.name)}</strong>
            <small>${escapeHtml(company.slug || "--")}</small>
          </div>
          <mark class="${company.status === "ACTIVE" ? "green" : "red"}">${escapeHtml(statusLabel)}</mark>
        </div>
        <div class="integration-company-metrics">
          <span><small>Plan</small><strong>${escapeHtml(company.plan || "Starter")}</strong></span>
          <span><small>Integrations</small><strong>${escapeHtml(`${connected} / ${total}`)}</strong></span>
          <span><small>Errors</small><strong>${escapeHtml(errors)}</strong></span>
          <span><small>Owner</small><strong>${escapeHtml(ownerLabel)}</strong></span>
          <span><small>Last login</small><strong>${formatDate(owner.lastLoginAt)}</strong></span>
        </div>
        <button class="primary-button" type="button" data-manage-integrations="${escapeHtml(company.id)}"><i data-lucide="settings-2"></i>Manage Integrations</button>
      </article>
    `;
  }).join("");
  refreshIcons();
}

async function openIntegrationDrawer(companyId) {
  const company = adminState.integrationCompanies.find((item) => item.id === companyId);
  if (!company) return;
  adminState.selectedIntegrationCompany = company;
  adminState.integrationDrawerTab = "integrations";
  renderIntegrationDrawerShell();
  const drawer = $("#integrationDrawer");
  drawer?.classList.remove("hidden");
  drawer?.setAttribute("aria-hidden", "false");
  document.body.classList.add("drawer-open");
  await loadIntegration(company.id);
}

function closeIntegrationDrawer() {
  $("#integrationDrawer")?.classList.add("hidden");
  $("#integrationDrawer")?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("drawer-open");
  adminState.selectedIntegrationCompany = null;
  adminState.integrations = [];
  adminState.integrationTests = {};
}

function renderIntegrationDrawerShell() {
  const company = adminState.selectedIntegrationCompany;
  if (!company) return;
  const owner = company.owner || {};
  $("#integrationDrawerIcon").textContent = initials(company.name);
  $("#integrationDrawerTitle").textContent = company.name || "Company integrations";
  $("#integrationDrawerMeta").textContent = `${company.slug || "--"} | ${company.plan || "Starter"} | ${company.status === "ACTIVE" ? "ACTIVE" : "DEACTIVATED"}`;
  $("#integrationDrawerStats").innerHTML = [
    ["Plan", company.plan || "Starter"],
    ["Status", company.status === "ACTIVE" ? "ACTIVE" : "DEACTIVATED"],
    ["Owner", owner.email || owner.username || "No owner assigned"],
    ["Last login", formatDate(owner.lastLoginAt)]
  ].map(([label, value]) => `<span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></span>`).join("");
  renderIntegrationDrawerTabs();
}

function renderIntegrationDrawerTabs() {
  document.querySelectorAll("[data-integration-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.integrationTab === adminState.integrationDrawerTab);
  });
  $("#integrationDrawerIntegrationsTab")?.classList.toggle("active", adminState.integrationDrawerTab === "integrations");
  $("#integrationDrawerLogsTab")?.classList.toggle("active", adminState.integrationDrawerTab === "logs");
}

async function loadIntegration(companyId = adminState.selectedIntegrationCompany?.id || "") {
  adminState.integrationTests = {};
  if (!companyId) {
    adminState.integration = null;
    adminState.integrations = [];
    renderIntegration();
    return;
  }
  const data = await api(`/admin/companies/${encodeURIComponent(companyId)}/integrations`);
  adminState.integrations = data.integrations || [];
  renderIntegration();
}

const integrationCardDefs = {
  GOOGLE_SHEETS: {
    icon: "file-spreadsheet",
    verifyText: "Save & Verify",
    testText: "Test Connection",
    fields: [
      { key: "GOOGLE_SHEETS_ID", label: "Google Sheets ID", placeholder: "Google Sheet ID from the sheet URL" },
      { key: "GOOGLE_SERVICE_ACCOUNT_EMAIL", label: "Google Service Account Email", placeholder: "service-account@project.iam.gserviceaccount.com" },
      { key: "GOOGLE_PRIVATE_KEY", label: "Google Private Key", placeholder: "-----BEGIN PRIVATE KEY----- ...", secret: true, textarea: true, help: "Share your Google Sheet with this service account email as Editor." }
    ]
  },
  WHATSAPP_CLOUD: {
    icon: "message-circle",
    verifyText: "Save & Verify",
    testText: "Test Connection",
    fields: [
      { key: "WHATSAPP_PHONE_NUMBER_ID", label: "WhatsApp Phone Number ID", placeholder: "Phone number ID", secret: true },
      { key: "WHATSAPP_BUSINESS_ACCOUNT_ID", label: "WhatsApp Business Account ID", placeholder: "Business account ID", secret: true },
      { key: "WHATSAPP_ACCESS_TOKEN", label: "WhatsApp Access Token", placeholder: "Meta access token", secret: true, textarea: true },
      { key: "WHATSAPP_VERIFY_TOKEN", label: "WhatsApp Verify Token", placeholder: "Webhook verify token", secret: true }
    ]
  },
  WHATSAPP_TEMPLATE_SETTINGS: {
    icon: "send",
    verifyText: "Verify Template",
    testText: "Test Template",
    noDisconnect: true,
    fields: [
      { key: "WHATSAPP_TEMPLATE_NAME", label: "Default WhatsApp Template Name", placeholder: "approved_template_name" },
      { key: "WHATSAPP_TEMPLATE_LANGUAGE", label: "Default WhatsApp Template Language", placeholder: "en_US" }
    ]
  },
  META_ADS: {
    icon: "megaphone",
    verifyText: "Save & Verify",
    testText: "Test Connection",
    fields: [
      { key: "META_ADS_ACCESS_TOKEN", label: "Meta Ads Access Token", placeholder: "Meta Marketing API token", secret: true, textarea: true },
      { key: "META_AD_ACCOUNT_ID", label: "Meta Ad Account ID", placeholder: "act_123456789 or 123456789", help: "META_AD_ACCOUNT_ID can be pasted with or without act_." },
      { key: "FACEBOOK_PAGE_ID", label: "Facebook Page ID", placeholder: "Page ID used for ad creatives" },
      { key: "META_BUSINESS_ID", label: "Meta Business ID", placeholder: "Optional business portfolio ID" },
      { key: "INSTAGRAM_ACTOR_ID", label: "Instagram Actor ID", placeholder: "Optional Instagram account identity" },
      { key: "META_PIXEL_ID", label: "Meta Pixel ID", placeholder: "Optional for later conversion tracking" }
    ]
  },
  KNOWLEDGE_BASE: {
    icon: "database-zap",
    verifyText: "Index Knowledge Base",
    testText: "Test AI Answer",
    noDisconnect: true,
    fields: [
      { key: "websiteUrl", label: "Company Website URL", placeholder: "https://company.com" },
      { key: "pdfFile", label: "PDF Upload", type: "file", accept: ".pdf,application/pdf" }
    ]
  },
  AI_MODEL: {
    icon: "bot",
    verifyText: "Save & Verify",
    testText: "Test AI",
    fields: [
      { key: "AI_PROVIDER", label: "AI Provider", type: "select", options: ["OPENAI", "ANTHROPIC", "GEMINI", "CUSTOM"] },
      { key: "AI_MODEL_NAME", label: "AI_MODEL_NAME", placeholder: "gpt-4.1-mini / gpt-4o-mini / claude model / etc." },
      { key: "AI_API_KEY", label: "AI_API_KEY", placeholder: "Provider API key", secret: true, textarea: true },
      { key: "AI_BASE_URL", label: "AI_BASE_URL", placeholder: "Required for custom OpenAI-compatible endpoints" }
    ]
  }
};

function integrationStatusClass(status) {
  if (status === "CONNECTED") return "green";
  if (status === "ERROR") return "red";
  if (status === "PARTIALLY_CONNECTED") return "yellow";
  return "neutral";
}

function integrationStatusLabel(integration) {
  if (integration.type === "KNOWLEDGE_BASE" && integration.metadata?.indexStatus === "INDEXED") return "Indexed";
  if (integration.status === "CONNECTED") return "Connected";
  if (integration.status === "ERROR") return "Error";
  if (integration.status === "PARTIALLY_CONNECTED") return "Needs Attention";
  return "Not Connected";
}

function savedFieldValue(integration, field) {
  const state = integration.fieldState?.[field.key];
  const value = state?.maskedValue || integration.maskedDisplay?.[field.key] || "";
  if (!value || state?.secret || field.secret || String(value).startsWith("********")) return "";
  return String(value);
}

function savedFieldText(integration, field) {
  const state = integration.fieldState?.[field.key];
  return state?.maskedValue || integration.maskedDisplay?.[field.key] || "Not saved";
}

function inputPlaceholder(integration, field) {
  const saved = savedFieldText(integration, field);
  if (saved !== "Not saved" && (field.secret || String(saved).startsWith("********"))) {
    return "Saved securely. Enter new value to replace.";
  }
  return field.placeholder || "";
}

function renderIntegrationField(integration, field) {
  const inputId = `integration-${integration.type}-${field.key}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const savedValue = savedFieldValue(integration, field);
  const placeholder = escapeHtml(inputPlaceholder(integration, field));
  const help = field.help ? `<small>${escapeHtml(field.help)}</small>` : "";
  const saved = `<small class="saved-value">Saved: ${escapeHtml(savedFieldText(integration, field))}</small>`;
  const conditionalClass = field.key === "AI_BASE_URL" && savedFieldValue(integration, { key: "AI_PROVIDER" }) !== "CUSTOM" ? " hidden" : "";

  if (field.type === "select") {
    return `
      <label class="${conditionalClass.trim()}">${escapeHtml(field.label)}
        <select id="${inputId}" data-integration-field="${escapeHtml(field.key)}">
          ${(field.options || []).map((option) => `<option value="${escapeHtml(option)}" ${savedValue === option ? "selected" : ""}>${escapeHtml(pretty(option))}</option>`).join("")}
        </select>
        ${saved}
      </label>
    `;
  }

  if (field.type === "file") {
    return `
      <label class="${conditionalClass.trim()}">${escapeHtml(field.label)}
        <input id="${inputId}" data-integration-field="${escapeHtml(field.key)}" type="file" accept="${escapeHtml(field.accept || "")}" />
        ${saved}
      </label>
    `;
  }

  if (field.textarea) {
    return `
      <label class="secret-field-wrap${conditionalClass}">${escapeHtml(field.label)}
        <textarea id="${inputId}" class="${field.secret ? "secret-hidden" : ""}" rows="${field.secret ? 4 : 3}" data-integration-field="${escapeHtml(field.key)}" ${field.secret ? 'data-secret-input="true"' : ""} placeholder="${placeholder}">${escapeHtml(savedValue)}</textarea>
        ${field.secret ? `<button class="icon-button secret-toggle" type="button" data-secret-toggle="${inputId}" title="Show typed value"><i data-lucide="eye"></i></button>` : ""}
        ${saved}${help}
      </label>
    `;
  }

  return `
    <label class="secret-field-wrap${conditionalClass}">${escapeHtml(field.label)}
      <input id="${inputId}" data-integration-field="${escapeHtml(field.key)}" type="${field.secret ? "password" : "text"}" value="${escapeHtml(savedValue)}" placeholder="${placeholder}" />
      ${field.secret ? `<button class="icon-button secret-toggle" type="button" data-secret-toggle="${inputId}" title="Show typed value"><i data-lucide="eye"></i></button>` : ""}
      ${saved}${help}
    </label>
  `;
}

function renderIntegrationMetadata(integration) {
  const metadata = integration.metadata || {};
  const rows = [];
  if (integration.lastVerifiedAt) rows.push(["Last verified", formatDate(integration.lastVerifiedAt)]);
  if (integration.lastVerificationError) rows.push(["Last error", integration.lastVerificationError]);
  if (metadata.spreadsheetTitle) rows.push(["Spreadsheet", metadata.spreadsheetTitle]);
  if (metadata.displayPhoneNumber) rows.push(["Phone", metadata.displayPhoneNumber]);
  if (metadata.verifiedName) rows.push(["Verified name", metadata.verifiedName]);
  if (metadata.webhookUrl) rows.push(["Webhook URL", metadata.webhookUrl]);
  if (metadata.verifyTokenStatus) rows.push(["Verify token", metadata.verifyTokenStatus]);
  if (metadata.lastWebhookReceivedAt) rows.push(["Last webhook", formatDate(metadata.lastWebhookReceivedAt)]);
  if (metadata.messageStatusWebhookStatus) rows.push(["Message webhook", pretty(metadata.messageStatusWebhookStatus)]);
  if (metadata.accountName || metadata.adAccountName) rows.push(["Ad account", metadata.accountName || metadata.adAccountName]);
  if (metadata.currency) rows.push(["Currency", metadata.currency]);
  if (metadata.timezone) rows.push(["Timezone", metadata.timezone]);
  if (metadata.pageName) rows.push(["Page", metadata.pageName]);
  if (metadata.instagramUsername) rows.push(["Instagram", metadata.instagramUsername]);
  if (metadata.indexStatus) rows.push(["Index status", pretty(metadata.indexStatus)]);
  if (metadata.chunksCreated !== undefined) rows.push(["Knowledge chunks", metadata.chunksCreated]);
  if (metadata.provider) rows.push(["Provider", pretty(metadata.provider)]);
  if (metadata.modelName) rows.push(["Model", metadata.modelName]);
  const test = adminState.integrationTests[integration.type];
  if (test?.message) rows.push(["Latest test", test.message]);

  if (!rows.length) return `<div class="integration-meta empty">No verification metadata yet.</div>`;
  return `
    <div class="integration-meta">
      ${rows.map(([label, value]) => `<span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value || "--")}</strong></span>`).join("")}
    </div>
  `;
}

function renderIntegration() {
  const target = $("#integrationVault");
  const summary = $("#integrationVaultSummary");
  if (!target) return;
  if (!adminState.integrations.length) {
    target.innerHTML = `<div class="empty-state"><strong>No account selected.</strong><span>Select or create a company to configure its integration vault.</span></div>`;
    if (summary) summary.innerHTML = "";
    return;
  }

  const connectedCount = adminState.integrations.filter((integration) => integration.status === "CONNECTED").length;
  const errorCount = adminState.integrations.filter((integration) => ["ERROR", "PARTIALLY_CONNECTED"].includes(integration.status)).length;
  if (adminState.selectedIntegrationCompany) {
    adminState.selectedIntegrationCompany.connectedIntegrationCount = connectedCount;
    adminState.selectedIntegrationCompany.errorIntegrationCount = errorCount;
    adminState.selectedIntegrationCompany.totalIntegrationCount = adminState.integrations.length;
    adminState.integrationCompanies = adminState.integrationCompanies.map((company) => (
      company.id === adminState.selectedIntegrationCompany.id ? adminState.selectedIntegrationCompany : company
    ));
    renderIntegrationDrawerShell();
    renderIntegrationCompanies();
    $("#integrationDrawer")?.classList.remove("hidden");
    $("#integrationDrawer")?.setAttribute("aria-hidden", "false");
  }
  if (summary) {
    summary.innerHTML = `
      <span><strong>${connectedCount}/${adminState.integrations.length}</strong><small>Connected</small></span>
      <span><strong>${errorCount}</strong><small>Errors</small></span>
      <span><strong>${adminState.integrations.filter((integration) => integration.status === "PARTIALLY_CONNECTED").length}</strong><small>Need verification</small></span>
    `;
  }

  target.innerHTML = adminState.integrations.map((integration) => {
    const def = integrationCardDefs[integration.type] || { fields: [], icon: "plug", verifyText: "Save & Verify", testText: "Test Connection" };
    return `
      <article class="integration-vault-card" data-integration-type="${escapeHtml(integration.type)}" data-integration-slug="${escapeHtml(integration.slug)}">
        <div class="integration-card-head">
          <span class="integration-provider-icon"><i data-lucide="${escapeHtml(def.icon)}"></i></span>
          <div>
            <strong>${escapeHtml(integration.label)}</strong>
            <small>${escapeHtml(integration.description)}</small>
          </div>
          <mark class="${integrationStatusClass(integration.status)}">${escapeHtml(integrationStatusLabel(integration))}</mark>
        </div>
        <div class="integration-field-grid">
          ${def.fields.map((field) => renderIntegrationField(integration, field)).join("")}
        </div>
        ${renderIntegrationMetadata(integration)}
        <div class="integration-action-row">
          <button class="secondary-button" type="button" data-integration-action="save"><i data-lucide="save"></i>Save</button>
          <button class="primary-button" type="button" data-integration-action="verify"><i data-lucide="shield-check"></i>${escapeHtml(def.verifyText)}</button>
          <button class="secondary-button" type="button" data-integration-action="test"><i data-lucide="activity"></i>${escapeHtml(def.testText)}</button>
          ${def.noDisconnect ? "" : `<button class="secondary-button danger-secondary" type="button" data-integration-action="disconnect"><i data-lucide="unlink"></i>Disconnect</button>`}
        </div>
      </article>
    `;
  }).join("");
  refreshIcons();
}

function integrationPayload(card) {
  const fields = [...card.querySelectorAll("[data-integration-field]")];
  const fileInput = fields.find((field) => field.type === "file" && field.files?.length);
  const useFormData = Boolean(fileInput);
  const payload = useFormData ? new FormData() : {};

  fields.forEach((field) => {
    const key = field.dataset.integrationField;
    if (!key) return;
    if (field.type === "file") {
      if (field.files?.[0]) payload.append(key, field.files[0]);
      return;
    }
    const value = String(field.value || "").trim();
    if (!value) return;
    if (useFormData) payload.append(key, value);
    else payload[key] = value;
  });

  return payload;
}

function upsertIntegrationState(integration) {
  if (!integration?.type) return;
  adminState.integrations = adminState.integrations.map((item) => item.type === integration.type ? integration : item);
}

function setIntegrationButtons(card, disabled) {
  card.querySelectorAll("button").forEach((item) => {
    item.disabled = disabled;
  });
}

async function submitIntegrationAction(card, action, button) {
  const companyId = adminState.selectedIntegrationCompany?.id;
  const slug = card.dataset.integrationSlug;
  const type = card.dataset.integrationType;
  const integration = adminState.integrations.find((item) => item.type === type) || {};
  if (!companyId || !slug) throw new Error("Select an account before updating integrations.");
  const previousHtml = button?.innerHTML;
  const label = integration.label || pretty(type);
  const companyName = adminState.selectedIntegrationCompany?.name || "this company";
  if (action === "disconnect" && !window.confirm(`Disconnect ${label} for ${companyName}?`)) return;
  setIntegrationButtons(card, true);
  if (button) button.innerHTML = `<i data-lucide="loader-circle"></i>${action === "verify" ? `Verifying ${label}...` : action === "test" ? `Testing ${label}...` : action === "disconnect" ? `Disconnecting ${label}...` : `Saving ${label}...`}`;
  refreshIcons();

  try {
    let data;
    if (action === "disconnect") {
      data = await api(`/admin/companies/${encodeURIComponent(companyId)}/integrations/${encodeURIComponent(slug)}/disconnect`, { method: "POST" });
      showNotice(`${label} disconnected.`);
    } else if (action === "test") {
      data = await api(`/admin/companies/${encodeURIComponent(companyId)}/integrations/${encodeURIComponent(slug)}/test`, {
        method: "POST",
        body: integrationPayload(card)
      });
      adminState.integrationTests[type] = data.test || {};
      const passed = data.test?.status === "CONNECTED";
      showNotice(data.test?.message || (passed ? `${label} test passed.` : `${label} test failed.`), !passed);
    } else {
      data = await api(`/admin/companies/${encodeURIComponent(companyId)}/integrations/${encodeURIComponent(slug)}${action === "verify" ? "?verify=true" : ""}`, {
        method: "PATCH",
        body: integrationPayload(card)
      });
      if (data.verification) {
        const passed = data.verification.status === "CONNECTED";
        showNotice(data.verification.message, !passed);
      } else {
        showNotice(`${label} saved securely.`);
      }
    }
    upsertIntegrationState(data.integration || data.verification?.integration);
    renderIntegration();
  } finally {
    if (button) {
      button.innerHTML = previousHtml || button.textContent;
    }
    setIntegrationButtons(card, false);
    refreshIcons();
  }
}

async function loadDiagnostics() {
  const data = await api("/debug/database-schema");
  adminState.diagnostics = data;
  renderDiagnostics();
}

function renderDiagnostics() {
  const status = adminState.diagnostics || {};
  const missingTables = status.missingTables || [];
  const missingMigrations = status.missingMigrations || [];
  setText("adminRuntimeStatus", status.databaseConnected && !missingTables.length ? "Ready" : "Check");
  $("#diagnosticsSummary").innerHTML = [
    ["Database connected", status.databaseConnected ? "Yes" : "No"],
    ["Migration applied", status.migrationApplied ? "Yes" : "No"],
    ["Missing tables", missingTables.length],
    ["Accounts", status.companyCount || 0],
    ["Members", status.userCount || 0],
    ["Node", status.nodeVersion || "--"],
    ["Prisma", status.prismaVersion || "--"]
  ].map(([label, value]) => `<span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></span>`).join("");

  const rows = [
    ["Existing tables", (status.tables || []).join(", ") || "--"],
    ["Missing tables", missingTables.join(", ") || "None"],
    ["Applied migrations", (status.migrations || []).join(", ") || "--"],
    ["Missing migrations", missingMigrations.join(", ") || "None"],
    ["Error", status.error || "None"]
  ];
  $("#diagnosticsTable").innerHTML = `
    <div class="data-row diagnostics-head"><span>Check</span><span>Result</span></div>
    ${rows.map(([label, value]) => `
      <div class="data-row diagnostics-row">
        <span>${escapeHtml(label)}</span>
        <span>${escapeHtml(value)}</span>
      </div>
    `).join("")}
  `;
}

async function loadFeatures() {
  const companyId = $("#featureCompanySelect")?.value || adminState.companies[0]?.id || "";
  if (!companyId) {
    $("#adminFeatureList").innerHTML = `<div class="empty-state"><strong>No account selected.</strong><span>Add an account first.</span></div>`;
    return;
  }
  const data = await api(`/admin/features?companyId=${encodeURIComponent(companyId)}`);
  adminState.features = data.features || [];
  renderFeatures();
}

function renderFeatures() {
  const target = $("#adminFeatureList");
  if (!target) return;
  target.innerHTML = adminState.features.map((feature) => `
    <article class="feature-toggle ${feature.enabled ? "active" : "inactive"}">
      <div class="feature-toggle-copy">
        <strong>${escapeHtml(feature.label)}</strong>
        <small>${escapeHtml(feature.description || featureDescriptions[feature.key] || "")}</small>
      </div>
        <mark class="${feature.enabled ? "green" : "neutral"}">${feature.enabled ? "Visible" : "Hidden"}</mark>
      <button class="toggle-switch ${feature.enabled ? "is-on" : "is-off"}" type="button" role="switch" aria-checked="${feature.enabled ? "true" : "false"}" data-feature-toggle="${escapeHtml(feature.id)}">
        <span class="toggle-track" aria-hidden="true"><i></i></span>
        <b>${feature.enabled ? "ON" : "OFF"}</b>
      </button>
    </article>
  `).join("");
}

async function loadBilling() {
  const params = new URLSearchParams();
  if ($("#billingCompanySelect")?.value) params.set("companyId", $("#billingCompanySelect").value);
  if ($("#billingStart")?.value) params.set("from", new Date($("#billingStart").value).toISOString());
  if ($("#billingEnd")?.value) params.set("to", new Date($("#billingEnd").value).toISOString());
  const data = await api(`/admin/billing?${params.toString()}`);
  adminState.billing = data;
  renderBilling();
}

function renderBilling() {
  const summary = adminState.billing.summary || {};
  $("#billingSummary").innerHTML = [
    ["WhatsApp API calls", summary.whatsappApiCalls || 0],
    ["Meta Ads API calls", summary.metaAdsApiCalls || 0],
    ["Claude API calls", summary.claudeApiCalls || 0],
    ["Google Sheets API calls", summary.googleSheetsApiCalls || 0],
    ["Internal API calls", summary.internalApiCalls || 0],
    ["Total API calls", summary.totalApiCalls || 0],
    ["Cost", summary.estimatedCost || "NIL"]
  ].map(([label, value]) => `<span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></span>`).join("");

  const logs = adminState.billing.logs || [];
  $("#billingTable").innerHTML = logs.length ? `
    <div class="data-row billing-head"><span>Date/time</span><span>Account</span><span>Provider</span><span>Endpoint</span><span>Status</span><span>Success</span><span>Units</span></div>
    ${logs.map((log) => `
      <div class="data-row billing-row">
        <span>${formatDate(log.createdAt)}</span>
        <span>${escapeHtml(log.company?.name || "--")}</span>
        <span>${escapeHtml(pretty(log.provider))}</span>
        <span>${escapeHtml(log.endpoint)}</span>
        <span>${escapeHtml(log.statusCode)}</span>
        <span><mark class="${log.success ? "green" : "red"}">${log.success ? "Success" : "Failure"}</mark></span>
        <span>${escapeHtml(log.requestUnits)}</span>
      </div>
    `).join("")}
  ` : `<div class="empty-state"><strong>No usage logs yet.</strong><span>External API calls will appear here after they run.</span></div>`;
}

function bindEvents() {
  document.querySelectorAll("[data-logout-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      logoutFromClient(form);
    });
  });

  document.querySelectorAll("[data-admin-view]").forEach((button) => button.addEventListener("click", () => switchAdminView(button.dataset.adminView)));
  $("#companyName")?.addEventListener("input", (event) => {
    if (!$("#companySlug")?.dataset.edited) $("#companySlug").value = event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  });
  $("#companySlug")?.addEventListener("input", (event) => {
    event.target.dataset.edited = "true";
  });
  $("#companyForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormErrors(event.currentTarget);
    try {
      const data = await api("/admin/companies", {
        method: "POST",
        body: JSON.stringify({
          name: $("#companyName").value,
          slug: $("#companySlug").value,
          status: $("#companyStatus").value
        })
      });
      upsertCompany(data.company);
      fillCompanySelects(data.company?.id || "");
      clearFormErrors(event.currentTarget);
      event.target.reset();
      $("#companySlug")?.removeAttribute("data-edited");
      showNotice("Company created.");
    } catch (error) {
      showFormError(event.currentTarget, error);
    }
  });
  $("#userForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createUserFromForm(event.currentTarget);
  });
  $("#userForm button[type='submit']")?.addEventListener("click", (event) => {
    event.preventDefault();
    const form = event.currentTarget.form;
    if (!form || form.dataset.submitting === "true") return;
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  $("#userSearch")?.addEventListener("input", (event) => {
    adminState.userFilters.search = event.target.value;
    renderUsers();
  });
  $("#userCompanyFilter")?.addEventListener("change", (event) => {
    adminState.userFilters.companyId = event.target.value;
    renderUsers();
  });
  $("#userStatusFilter")?.addEventListener("change", (event) => {
    adminState.userFilters.status = event.target.value;
    renderUsers();
  });
  $("#userRoleFilter")?.addEventListener("change", (event) => {
    adminState.userFilters.role = event.target.value;
    renderUsers();
  });
  $("#adminUsersTable")?.addEventListener("click", async (event) => {
    const reset = event.target.closest("[data-user-reset]");
    const status = event.target.closest("[data-user-status]");
    if (reset) {
      const password = window.prompt("New password (minimum 8 characters)");
      if (!password) return;
      await api(`/admin/users/${reset.dataset.userReset}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password, confirmPassword: password })
      });
      showNotice("Password reset. Password remains hidden.");
    }
    if (status) {
      const user = adminState.users.find((item) => item.id === status.dataset.userStatus);
      await api(`/admin/users/${status.dataset.userStatus}`, {
        method: "PATCH",
        body: JSON.stringify({ status: user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })
      });
      showNotice("User status updated.");
      await loadUsers();
    }
  });
  $("#featureCompanySelect")?.addEventListener("change", () => loadFeatures().catch((error) => showNotice(error.message, true)));
  $("#integrationCompanyCards")?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-manage-integrations]");
    const companyId = target?.dataset.manageIntegrations;
    if (!companyId) return;
    openIntegrationDrawer(companyId).catch((error) => showNotice(error.message, true));
  });
  document.querySelectorAll("[data-close-integration-drawer]").forEach((button) => {
    button.addEventListener("click", closeIntegrationDrawer);
  });
  document.querySelectorAll("[data-integration-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      adminState.integrationDrawerTab = button.dataset.integrationTab || "integrations";
      renderIntegrationDrawerTabs();
    });
  });
  $("#integrationVault")?.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-secret-toggle]");
    if (toggle) {
      const field = document.getElementById(toggle.dataset.secretToggle);
      if (!field) return;
      if (field.tagName === "TEXTAREA") field.classList.toggle("secret-hidden");
      if (field.tagName === "INPUT") field.type = field.type === "password" ? "text" : "password";
      return;
    }

    const button = event.target.closest("[data-integration-action]");
    if (!button) return;
    const card = button.closest("[data-integration-type]");
    if (!card) return;
    submitIntegrationAction(card, button.dataset.integrationAction, button).catch((error) => showNotice(error.message, true));
  });
  $("#integrationVault")?.addEventListener("change", (event) => {
    const provider = event.target.closest('[data-integration-field="AI_PROVIDER"]');
    if (!provider) return;
    const card = provider.closest("[data-integration-type]");
    const baseUrlField = card?.querySelector('[data-integration-field="AI_BASE_URL"]')?.closest("label");
    baseUrlField?.classList.toggle("hidden", provider.value !== "CUSTOM");
  });
  $("#adminFeatureList")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-feature-toggle]");
    if (!button || button.disabled) return;
    const enabled = button.getAttribute("aria-checked") !== "true";
    const row = button.closest(".feature-toggle");
    const label = button.querySelector("b");
    const status = row?.querySelector("mark");
    button.disabled = true;
    button.setAttribute("aria-checked", enabled ? "true" : "false");
    button.classList.toggle("is-on", enabled);
    button.classList.toggle("is-off", !enabled);
    row?.classList.toggle("active", enabled);
    row?.classList.toggle("inactive", !enabled);
    if (label) label.textContent = enabled ? "ON" : "OFF";
    if (status) {
      status.textContent = enabled ? "Active" : "Inactive";
      status.className = enabled ? "green" : "neutral";
    }
    try {
      const data = await api(`/admin/features/${button.dataset.featureToggle}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled })
      });
      adminState.features = adminState.features.map((feature) => feature.id === data.feature.id ? data.feature : feature);
      showNotice("Entitlements updated.");
    } catch (error) {
      await loadFeatures();
      showNotice(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  $("#refreshBillingBtn")?.addEventListener("click", () => loadBilling().catch((error) => showNotice(error.message, true)));
  $("#refreshDiagnosticsBtn")?.addEventListener("click", () => loadDiagnostics().catch((error) => showNotice(error.message, true)));
  $("#billingCompanySelect")?.addEventListener("change", () => loadBilling().catch((error) => showNotice(error.message, true)));
  $("#exportBillingBtn")?.addEventListener("click", () => {
    const params = new URLSearchParams();
    if ($("#billingCompanySelect")?.value) params.set("companyId", $("#billingCompanySelect").value);
    if ($("#billingStart")?.value) params.set("from", new Date($("#billingStart").value).toISOString());
    if ($("#billingEnd")?.value) params.set("to", new Date($("#billingEnd").value).toISOString());
    window.location.href = `/api/admin/billing/export?${params.toString()}`;
  });
}

async function start() {
  bindEvents();
  bindSessionRestoreGuard();
  await loadLucide();
  await loadCompanies();
  await loadUsers();
  if (adminState.companies[0]) {
    $("#featureCompanySelect").value = adminState.companies[0].id;
    await loadFeatures();
  }
  if (window.location.pathname === "/admin/integrations") {
    switchAdminView("integrations");
  }
  await loadBilling();
  await loadDiagnostics();
  refreshIcons();
}

start().catch((error) => showNotice(error.message, true));
