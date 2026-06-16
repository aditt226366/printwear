const adminState = {
  companies: [],
  users: [],
  features: [],
  integration: null,
  diagnostics: null,
  billing: { summary: {}, logs: [] },
  currentView: "users",
  userFilters: {
    search: "",
    companyId: "",
    status: "",
    role: ""
  }
};

const featureDescriptions = {
  dashboard: "Command metrics, import leads, and welcome sends.",
  chats: "Live WhatsApp conversations and manual replies.",
  contacts_broadcasts: "Audience imports, contact management, and broadcasts.",
  campaigns: "Scheduled WhatsApp outreach and campaign reporting.",
  ads: "Click-to-WhatsApp ad drafts and Meta status checks.",
  ai_flows: "Workflow builder, triggers, and automation logs.",
  human_queue: "Manual takeover queue and priority follow-ups.",
  orders: "Order summaries, dispatch status, and customer updates.",
  reports: "Performance dashboards and CRM analytics.",
  settings: "Account/session controls and workspace settings."
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

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || "Request failed");
  return data;
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

function fillCompanySelects() {
  const options = adminState.companies.map((company) => `<option value="${escapeHtml(company.id)}">${escapeHtml(company.name)}</option>`).join("");
  ["userCompany", "featureCompanySelect", "integrationCompanySelect", "billingCompanySelect", "userCompanyFilter"].forEach((id) => {
    const select = $(`#${id}`);
    if (!select) return;
    const current = select.value;
    select.innerHTML = ["billingCompanySelect", "userCompanyFilter"].includes(id) ? `<option value="">All companies</option>${options}` : options;
    if (current) select.value = current;
  });
}

async function loadCompanies() {
  const data = await api("/admin/companies");
  adminState.companies = data.companies || [];
  fillCompanySelects();
}

async function loadUsers() {
  const data = await api("/admin/users");
  adminState.users = data.users || [];
  renderUsers();
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
    table.innerHTML = `<div class="empty-state"><strong>No users yet.</strong><span>Create a company and user to begin.</span></div>`;
    return;
  }
  const users = filteredUsers();
  if (!users.length) {
    table.innerHTML = `<div class="empty-state"><strong>No users match these filters.</strong><span>Adjust search, company, role, or status to see more accounts.</span></div>`;
    return;
  }
  table.innerHTML = `
    <div class="data-row admin-users-head">
      <span>User</span><span>Company</span><span>Role</span><span>Status</span><span>Last Login</span><span>Created</span><span>Actions</span>
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
          ${user.role === "USER" ? `<button class="secondary-button compact-admin-action" type="button" data-user-status="${escapeHtml(user.id)}">${user.status === "ACTIVE" ? "Deactivate" : "Activate"}</button>` : ""}
        </span>
      </div>
    `).join("")}
  `;
  refreshIcons();
}

async function loadIntegration() {
  const companyId = $("#integrationCompanySelect")?.value || adminState.companies[0]?.id || "";
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
  $("#integrationGooglePrivateKeyMasked").textContent = integration.googlePrivateKeyMasked ? `Saved: ${integration.googlePrivateKeyMasked}` : "No key saved.";
  $("#integrationWhatsappPhoneNumberId").value = integration.whatsappPhoneNumberId || "";
  $("#integrationWhatsappBusinessAccountId").value = integration.whatsappBusinessAccountId || "";
  $("#integrationWhatsappTemplateName").value = integration.whatsappDefaultTemplateName || "";
  $("#integrationWhatsappTemplateLanguage").value = integration.whatsappTemplateLanguage || "en";
  $("#integrationWhatsappVerifyToken").value = "";
  $("#integrationWhatsappAccessToken").value = "";
  $("#integrationWhatsappAccessTokenMasked").textContent = integration.whatsappAccessTokenMasked ? `Saved: ${integration.whatsappAccessTokenMasked}` : "No token saved.";
  $("#integrationMetaAdAccountId").value = integration.metaAdAccountId || "";
  $("#integrationMetaAdsAccessToken").value = "";
  $("#integrationMetaAdsAccessTokenMasked").textContent = integration.metaAdsAccessTokenMasked ? `Saved: ${integration.metaAdsAccessTokenMasked}` : "No token saved.";
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
    ["Companies", status.companyCount || 0],
    ["Users", status.userCount || 0],
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
    $("#adminFeatureList").innerHTML = `<div class="empty-state"><strong>No company selected.</strong><span>Create a company first.</span></div>`;
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
      <mark class="${feature.enabled ? "green" : "neutral"}">${feature.enabled ? "Active" : "Inactive"}</mark>
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
    ["Estimated cost", summary.estimatedCost || "-NIL-"]
  ].map(([label, value]) => `<span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></span>`).join("");

  const logs = adminState.billing.logs || [];
  $("#billingTable").innerHTML = logs.length ? `
    <div class="data-row billing-head"><span>Date/time</span><span>Company</span><span>Provider</span><span>Endpoint</span><span>Status</span><span>Success</span><span>Units</span></div>
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
  document.querySelectorAll("[data-admin-view]").forEach((button) => button.addEventListener("click", () => switchAdminView(button.dataset.adminView)));
  $("#companyName")?.addEventListener("input", (event) => {
    if (!$("#companySlug")?.dataset.edited) $("#companySlug").value = event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  });
  $("#companySlug")?.addEventListener("input", (event) => {
    event.target.dataset.edited = "true";
  });
  $("#companyForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/admin/companies", {
      method: "POST",
      body: JSON.stringify({
        name: $("#companyName").value,
        slug: $("#companySlug").value,
        status: $("#companyStatus").value
      })
    });
    event.target.reset();
    showNotice("Company created.");
    await loadCompanies();
  });
  $("#userForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
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
    event.target.reset();
    showNotice("User created.");
    await loadUsers();
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
    await loadIntegration();
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
      showNotice("Feature access updated.");
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
