const adminState = {
  companies: [],
  users: [],
  features: [],
  integration: null,
  integrationTests: {},
  diagnostics: null,
  billing: { summary: {}, logs: [] },
  currentView: "companies",
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

function isDevelopmentHost() {
  return ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const fieldErrors = data.fieldErrors || data.details?.fieldErrors || {};
    if (isDevelopmentHost() && Object.keys(fieldErrors).length) console.log("Validation error", response);
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
  document.querySelectorAll("[data-admin-view]").forEach((button) => button.classList.toggle("active", button.dataset.adminView === view));
  document.querySelectorAll("main > .view").forEach((section) => section.classList.remove("active-view"));
  $(`#admin${view[0].toUpperCase()}${view.slice(1)}View`)?.classList.add("active-view");
  if (view === "features") loadFeatures().catch((error) => showNotice(error.message, true));
  if (view === "integrations") loadIntegration().catch((error) => showNotice(error.message, true));
  if (view === "billing") loadBilling().catch((error) => showNotice(error.message, true));
  if (view === "diagnostics") loadDiagnostics().catch((error) => showNotice(error.message, true));
}

function fillCompanySelects(selectedUserCompanyId = "") {
  const options = adminState.companies.map((company) => `<option value="${escapeHtml(company.id)}">${escapeHtml(company.name)}</option>`).join("");
  ["userCompany", "featureCompanySelect", "integrationCompanySelect", "billingCompanySelect", "userCompanyFilter"].forEach((id) => {
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

async function loadIntegration() {
  const companyId = $("#integrationCompanySelect")?.value || adminState.companies[0]?.id || "";
  adminState.integrationTests = {};
  if (!companyId) {
    adminState.integration = null;
    return;
  }
  const data = await api(`/admin/company-integrations?companyId=${encodeURIComponent(companyId)}`);
  adminState.integration = data.integration || null;
  renderIntegration();
}

function renderIntegration() {
  const integration = adminState.integration || {};
  $("#integrationGoogleSheetsId").value = integration.googleSheetsId || "";
  $("#integrationGoogleServiceAccountEmail").value = integration.googleServiceAccountEmail || "";
  $("#integrationGooglePrivateKey").value = "";
  $("#integrationGooglePrivateKeyMasked").textContent = integration.googlePrivateKeyMasked || "No key saved.";
  $("#integrationWhatsappPhoneNumberId").value = integration.whatsappPhoneNumberId || "";
  $("#integrationWhatsappBusinessAccountId").value = integration.whatsappBusinessAccountId || "";
  $("#integrationWhatsappTemplateName").value = integration.whatsappDefaultTemplateName || "";
  $("#integrationWhatsappTemplateLanguage").value = integration.whatsappTemplateLanguage || "en";
  $("#integrationWhatsappVerifyToken").value = "";
  $("#integrationWhatsappAccessToken").value = "";
  $("#integrationWhatsappAccessTokenMasked").textContent = integration.whatsappAccessTokenMasked || "No token saved.";
  $("#integrationMetaAdAccountId").value = integration.metaAdAccountId || "";
  $("#integrationMetaAdsAccessToken").value = "";
  $("#integrationMetaAdsAccessTokenMasked").textContent = integration.metaAdsAccessTokenMasked || "No token saved.";
  renderIntegrationTests();
}

function renderIntegrationTests() {
  const target = $("#integrationTestResults");
  if (!target) return;
  const rows = Object.entries(adminState.integrationTests);
  if (!rows.length) {
    target.innerHTML = `<div class="empty-state"><strong>No tests run yet.</strong><span>Save credentials, then test each provider.</span></div>`;
    return;
  }
  target.innerHTML = rows.map(([provider, result]) => `
    <article class="integration-test-result ${result.connected || result.readable ? "connected" : "failed"}">
      <div>
        <strong>${escapeHtml(pretty(provider))}</strong>
        <small>${escapeHtml(result.error || "Connection verified.")}</small>
      </div>
      <mark class="${result.connected || result.readable ? "green" : "red"}">${result.connected || result.readable ? "Connected" : "Failed"}</mark>
    </article>
  `).join("");
}

async function testIntegration(provider, button) {
  const companyId = $("#integrationCompanySelect")?.value;
  if (!companyId) throw new Error("Select an account before testing connections.");
  const labels = {
    whatsapp: "WhatsApp",
    googleSheets: "Google Sheets",
    metaAds: "Meta Ads"
  };
  const paths = {
    whatsapp: `/admin/company-integrations/${encodeURIComponent(companyId)}/test/whatsapp`,
    googleSheets: `/admin/company-integrations/${encodeURIComponent(companyId)}/test/google-sheets`,
    metaAds: `/admin/company-integrations/${encodeURIComponent(companyId)}/test/meta-ads`
  };
  const previousText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = `Testing ${labels[provider]}...`;
  }
  try {
    const requestOptions = { method: "POST" };
    if (provider === "googleSheets") {
      requestOptions.body = JSON.stringify({
        googleSheetsId: $("#integrationGoogleSheetsId").value,
        googleServiceAccountEmail: $("#integrationGoogleServiceAccountEmail").value,
        googlePrivateKey: $("#integrationGooglePrivateKey").value
      });
    } else if (provider === "whatsapp") {
      requestOptions.body = JSON.stringify({
        whatsappPhoneNumberId: $("#integrationWhatsappPhoneNumberId").value,
        whatsappBusinessAccountId: $("#integrationWhatsappBusinessAccountId").value,
        whatsappAccessToken: $("#integrationWhatsappAccessToken").value,
        whatsappVerifyToken: $("#integrationWhatsappVerifyToken").value,
        whatsappDefaultTemplateName: $("#integrationWhatsappTemplateName").value,
        whatsappTemplateLanguage: $("#integrationWhatsappTemplateLanguage").value || "en"
      });
    } else if (provider === "metaAds") {
      requestOptions.body = JSON.stringify({
        metaAdAccountId: $("#integrationMetaAdAccountId").value,
        metaAdsAccessToken: $("#integrationMetaAdsAccessToken").value
      });
    }
    const data = await api(paths[provider], requestOptions);
    adminState.integrationTests[provider] = data.test || {};
    renderIntegrationTests();
    const passed = Boolean(data.test?.connected || data.test?.readable);
    showNotice(passed ? `${labels[provider]} test passed.` : `${labels[provider]} test failed: ${data.test?.error || "Check the saved connection settings."}`, !passed);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousText || `Test ${labels[provider]}`;
      refreshIcons();
    }
  }
}

async function clearIntegrationProvider(provider, button) {
  const companyId = $("#integrationCompanySelect")?.value;
  if (!companyId) throw new Error("Select an account before clearing connections.");
  const labels = {
    whatsapp: "WhatsApp",
    googleSheets: "Google Sheets",
    metaAds: "Meta Ads"
  };
  const paths = {
    whatsapp: `/admin/company-integrations/${encodeURIComponent(companyId)}/whatsapp`,
    googleSheets: `/admin/company-integrations/${encodeURIComponent(companyId)}/google-sheets`,
    metaAds: `/admin/company-integrations/${encodeURIComponent(companyId)}/meta-ads`
  };
  const previousText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = `Clearing ${labels[provider]}...`;
  }
  try {
    const data = await api(paths[provider], { method: "DELETE" });
    adminState.integration = data.integration || null;
    adminState.integrationTests = {};
    renderIntegration();
    showNotice(`${labels[provider]} connection cleared.`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousText || `Clear ${labels[provider]}`;
      refreshIcons();
    }
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
  $("#integrationCompanySelect")?.addEventListener("change", () => loadIntegration().catch((error) => showNotice(error.message, true)));
  $("#integrationForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const companyId = $("#integrationCompanySelect")?.value;
    await api("/admin/company-integrations", {
      method: "PUT",
      body: JSON.stringify({
        companyId,
        googleSheetsId: $("#integrationGoogleSheetsId").value,
        googleServiceAccountEmail: $("#integrationGoogleServiceAccountEmail").value,
        googlePrivateKey: $("#integrationGooglePrivateKey").value,
        whatsappPhoneNumberId: $("#integrationWhatsappPhoneNumberId").value,
        whatsappBusinessAccountId: $("#integrationWhatsappBusinessAccountId").value,
        whatsappAccessToken: $("#integrationWhatsappAccessToken").value,
        whatsappVerifyToken: $("#integrationWhatsappVerifyToken").value,
        whatsappDefaultTemplateName: $("#integrationWhatsappTemplateName").value,
        whatsappTemplateLanguage: $("#integrationWhatsappTemplateLanguage").value || "en",
        metaAdAccountId: $("#integrationMetaAdAccountId").value,
        metaAdsAccessToken: $("#integrationMetaAdsAccessToken").value
      })
    });
    showNotice("Integration settings saved. Secrets remain masked.");
    adminState.integrationTests = {};
    await loadIntegration();
  });
  $("#testWhatsappIntegrationBtn")?.addEventListener("click", (event) => {
    testIntegration("whatsapp", event.currentTarget).catch((error) => showNotice(error.message, true));
  });
  $("#testGoogleSheetsIntegrationBtn")?.addEventListener("click", (event) => {
    testIntegration("googleSheets", event.currentTarget).catch((error) => showNotice(error.message, true));
  });
  $("#testMetaAdsIntegrationBtn")?.addEventListener("click", (event) => {
    testIntegration("metaAds", event.currentTarget).catch((error) => showNotice(error.message, true));
  });
  $("#clearGoogleSheetsIntegrationBtn")?.addEventListener("click", (event) => {
    clearIntegrationProvider("googleSheets", event.currentTarget).catch((error) => showNotice(error.message, true));
  });
  $("#clearWhatsappIntegrationBtn")?.addEventListener("click", (event) => {
    clearIntegrationProvider("whatsapp", event.currentTarget).catch((error) => showNotice(error.message, true));
  });
  $("#clearMetaAdsIntegrationBtn")?.addEventListener("click", (event) => {
    clearIntegrationProvider("metaAds", event.currentTarget).catch((error) => showNotice(error.message, true));
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
    $("#integrationCompanySelect").value = adminState.companies[0].id;
    await loadFeatures();
    await loadIntegration();
  }
  await loadBilling();
  await loadDiagnostics();
  refreshIcons();
}

start().catch((error) => showNotice(error.message, true));
