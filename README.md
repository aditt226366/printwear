# WhatsApp CRM Automation Platform

This project is a multi-tenant Express, Prisma, PostgreSQL, and static frontend CRM for WhatsApp sales operations. It imports leads and contacts from Google Sheets or CSV, sends approved WhatsApp templates, receives WhatsApp webhooks, stores chat history, assists replies with Claude, tracks order intent, supports human takeover, runs campaigns and broadcasts, and gives platform admins company, user, integration, feature, billing, and diagnostic controls.

The frontend is intentionally simple at the build layer: server-rendered static HTML plus plain browser JavaScript and CSS in `public/`. The product experience is still rich: a platform admin console for operators and a company-branded CRM command center for client users.

## Current Product Scope

- Platform administration for companies, users, feature access, integrations, diagnostics, and API usage.
- Company-branded user dashboard with command metrics, inbox, audience, campaigns, ads, AI flows, takeover queue, order desk, reports, and settings.
- Tenant-scoped data isolation by `companyId` across users, leads, contacts, campaigns, integrations, knowledge, billing, and automation objects.
- Per-company encrypted integration credentials for Google Sheets, WhatsApp Cloud API, and Meta Ads.
- Google Sheets lead/contact import with saved or environment fallback credentials.
- WhatsApp outbound messaging through Meta Cloud API, including initial templates, manual replies, bulk sends, campaigns, and order actions.
- WhatsApp webhook processing for inbound messages and status updates.
- Claude-assisted reply generation, knowledge retrieval, order extraction, and human attention logic.
- Knowledge base management from manual entries, websites, PDF, DOCX, and TXT uploads.
- Human takeover workflow for conversations that need manual handling.
- Order summary and order status pipeline derived from conversation history.
- API usage tracking for billing and diagnostics.

## Tech Stack

- Node.js 22
- Express.js
- TypeScript
- PostgreSQL
- Prisma ORM
- Static HTML, CSS, and browser JavaScript
- Google Sheets API
- Meta WhatsApp Cloud API
- Meta Ads API status checks and ad draft planning
- Claude Messages API
- Pino structured logging
- Helmet, CORS, bcrypt, Zod, Multer

## Runtime Requirements

Use Node 22 locally and in production.

Node 24 has caused Prisma TLS problems against Supabase in this environment, so prefer Node 22 for database verification, migrations, preview, and production-like runs.

Common Windows commands:

```bash
nvm use 22
npm install
cmd /c npm run build
cmd /c npm run start
```

Development server:

```bash
npm run dev
```

Health checks:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/health
```

Expected response:

```json
{ "status": "ok" }
```

## Main Files

- `src/app.ts`: Express app setup, static assets, page redirects, route mounting, and error middleware.
- `src/server.ts`: server startup, schema diagnostics, startup integration encryption diagnostic.
- `src/routes/api.routes.ts`: authenticated JSON APIs for admin, dashboard, integrations, automation, and diagnostics.
- `src/routes/admin.routes.ts`: admin/dashboard compatibility APIs under `/admin/api`.
- `src/routes/auth.routes.ts`: login, logout, and protected page delivery.
- `src/routes/webhook.routes.ts`: Meta webhook verification and inbound webhook handling.
- `src/controllers/*`: HTTP request parsing and controller-level validation.
- `src/services/*`: business logic for auth, dashboard, integrations, WhatsApp, Google Sheets, Claude, contacts, campaigns, workflows, orders, billing, and webhooks.
- `src/jobs/*`: server-side lead import and initial-message jobs.
- `src/middleware/*`: auth, feature gating, and error handling.
- `src/utils/*`: tenant scoping, errors, integration config diagnostics, logging, phone normalization, and helpers.
- `public/login.html`: shared login page.
- `public/admin.html`: platform admin console.
- `public/dashboard.html`: company CRM command center.
- `public/assets/admin.js`: admin console state, forms, tables, integration tests, validation display, and toasts.
- `public/assets/dashboard.js`: CRM dashboard state, feature-gated views, polling, SSE, chat, automation controls, and fallback UI.
- `public/assets/styles.css`: shared admin/dashboard visual system.
- `prisma/schema.prisma`: database schema and enums.
- `prisma/seed.ts`: default seed data and knowledge setup.

## Application Entry Points

- `GET /`: redirects anonymous users to `/login`, admins to `/admin`, and CRM users to `/dashboard`.
- `GET /login`: shared login page for admins and users.
- `POST /auth/login`: username/email and password login.
- `POST /auth/logout`: logout endpoint.
- `GET /admin`: platform admin UI.
- `GET /dashboard`: company user CRM UI.
- `GET /health`: basic service health.
- `GET /api/health`: API health alias.
- `/assets/*`: static JavaScript, CSS, and client assets.

## Authentication And Roles

The app uses database-backed users in `AppUser`.

- `ADMIN` users access `/admin` and admin APIs.
- `USER` users access `/dashboard` and feature-gated CRM APIs.
- Login accepts username or email.
- Passwords are stored only as bcrypt hashes.
- Inactive users cannot log in.
- Failed login responses stay generic.
- The server seeds the first admin from env values only when no admin exists.

Important auth environment variables:

```env
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this-password
ADMIN_NAME=Admin
SESSION_SECRET=use-a-long-random-secret-at-least-32-characters
```

Optional initial user variables:

```env
USER_USERNAME=user
USER_EMAIL=user@example.com
USER_PASSWORD=change-this-password
USER_NAME=CRM User
DEFAULT_COMPANY_NAME=Demo Company
DEFAULT_COMPANY_SLUG=demo-company
```

## Multi-Tenant Model

Tenant ownership is centered on `Company`.

Each company can have:

- Users
- Feature toggles
- Integration credentials
- Leads
- Knowledge base entries
- Contacts
- Bulk message jobs
- Campaigns
- Ad drafts
- AI workflows
- API usage logs
- Billing snapshots

Most user-facing queries and mutations are scoped with `companyId` through helpers such as `companyScope(res)` and `sessionCompanyId(res)`.

Admins can select a company in admin tools. CRM users only operate inside their logged-in company.

## Database Models

Core platform models:

- `Company`: tenant profile, status, branding, and ownership root.
- `CompanyIntegration`: per-company Google, WhatsApp, and Meta Ads settings. Secret fields are encrypted.
- `AppUser`: admin and user login records.
- `CompanyFeature`: per-company module visibility and API access control.
- `ApiUsageLog`: tracked external and internal API calls.
- `BillingSnapshot`: optional usage rollup snapshots.

CRM and automation models:

- `Lead`: WhatsApp lead with status, temperature, source, and company ownership.
- `Message`: inbound and outbound WhatsApp history.
- `KnowledgeBase`: tenant-scoped AI context entries.
- `SendLog`: send attempts and failures.
- `BulkMessageJob`: broadcast job metadata.
- `BulkMessageRecipient`: per-recipient broadcast delivery state.
- `Campaign`: scheduled or immediate WhatsApp campaign.
- `CampaignRecipient`: campaign audience and delivery state.
- `AdDraft`: click-to-WhatsApp ad planning draft.
- `AiWorkflow`: workflow builder configuration.
- `WorkflowExecutionLog`: workflow run records.
- `FeatureFlag`: general feature flag table.
- `OrderSummary`: extracted order details and order pipeline status.

Important enums:

- `LeadStatus`: `NEW`, `MESSAGED`, `REPLIED`, `FAILED`
- `LeadTemperature`: `HOT`, `WARM`, `SCRAP`
- `HumanPriority`: `HIGH`, `MEDIUM`, `LOW`
- `OrderStatus`: `COLLECTING_DETAILS`, `READY_FOR_REVIEW`, `QUOTATION_NEEDED`, `CONFIRMED`, `READY_FOR_DISPATCH`, `DISPATCHED`, `CANCELLED`
- `MessageDirection`: `INBOUND`, `OUTBOUND`
- `MessageType`: `TEXT`, `TEMPLATE`, `IMAGE`, `VIDEO`, `DOCUMENT`, `AUDIO`
- `MessageStatus`: `PENDING`, `SENT`, `DELIVERED`, `READ`, `FAILED`, `RECEIVED`
- `AutomationSendStatus`: `QUEUED`, `SENT`, `FAILED`, `DELIVERED`, `READ`
- `BulkJobStatus`: `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`
- `CampaignStatus`: `DRAFT`, `SCHEDULED`, `RUNNING`, `COMPLETED`, `FAILED`, `PAUSED`, `CANCELLED`
- `CampaignType`: `WHATSAPP_TEMPLATE`
- `WorkflowTriggerType`: `KEYWORD`, `REGEX`, `TEMPLATE`, `AD`
- `WorkflowRunStatus`: `STARTED`, `EXECUTED`, `FAILED`
- `KnowledgeSourceType`: `MANUAL`, `WEBSITE`, `UPLOAD`, `SEED`
- `CompanyStatus`: `ACTIVE`, `INACTIVE`
- `AppUserRole`: `ADMIN`, `USER`
- `AppUserStatus`: `ACTIVE`, `INACTIVE`
- `ApiProvider`: `META_WHATSAPP`, `META_ADS`, `CLAUDE`, `GOOGLE_SHEETS`, `INTERNAL`

## Environment Variables

See `.env.example` for the baseline list.

Server and database:

```env
PORT=3000
DATABASE_URL=postgresql://...
SESSION_SECRET=...
LOG_LEVEL=info
```

Admin and seed users:

```env
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this-password
ADMIN_NAME=Admin
USER_USERNAME=user
USER_NAME=CRM User
USER_EMAIL=user@example.com
USER_PASSWORD=change-this-password
DEFAULT_COMPANY_NAME=Demo Company
DEFAULT_COMPANY_SLUG=demo-company
```

Integration encryption:

```env
INTEGRATION_ENCRYPTION_KEY=long-random-secret-at-least-16-characters
```

This key is required only when saving or decrypting encrypted integration secrets. Normal login, user creation, and dashboard loading must not depend on it. Startup logs expose only:

```json
{ "integrationEncryptionKeyConfigured": true }
```

The key value is never logged or returned by APIs.

WhatsApp:

```env
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_BUSINESS_ACCOUNT_ID=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_VERIFY_TOKEN=...
WHATSAPP_TEMPLATE_NAME=...
WHATSAPP_TEMPLATE_LANGUAGE=en_US
WHATSAPP_API_VERSION=v20.0
AUTOMATION_SEND_DELAY_MS=1200
AUTOMATION_WORKERS_ENABLED=true
```

Google Sheets:

```env
GOOGLE_SHEETS_ID=...
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
GOOGLE_SHEETS_RANGE=Sheet1!A:C
GOOGLE_SHEETS_STATUS_COLUMN=C
```

Google private keys may contain escaped `\n`; the service normalizes escaped newlines into real newlines before use.

Meta Ads:

```env
META_AD_ACCOUNT_ID=...
META_ADS_ACCESS_TOKEN=...
```

Claude:

```env
ANTHROPIC_API_KEY=...
CLAUDE_MODEL=claude-sonnet-4-6
```

Knowledge ingestion:

```env
PRINTWEAR_WEBSITE_URL=https://printwear.in
KNOWLEDGE_CRAWL_MAX_PAGES=12
KNOWLEDGE_CHUNK_SIZE=1200
```

## Setup

Install dependencies:

```bash
npm install
```

Create `.env`:

```bash
copy .env.example .env
```

Generate Prisma client:

```bash
npm run prisma:generate
```

Run migrations:

```bash
npm run prisma:migrate
```

Seed default data:

```bash
npm run seed
```

Build:

```bash
cmd /c npm run build
```

Start:

```bash
npm run start
```

Development:

```bash
npm run dev
```

## Scripts

- `npm run dev`: run TypeScript server with `tsx watch`.
- `npm run build`: compile TypeScript to `dist/src`.
- `npm run start`: start compiled server from `dist/src/server.js`.
- `npm run prisma:migrate`: run Prisma development migrations.
- `npm run prisma:generate`: generate Prisma client.
- `npm run seed`: seed default data and knowledge.
- `npm run leads:recalculate`: recalculate lead temperatures.
- `npm run ops:rebuild`: rebuild operational queues.

## Platform Admin UI

The admin console is at `/admin` and is intentionally platform-neutral. It should not use a tenant brand as the platform identity.

Admin navigation:

- `Users`
- `Features`
- `Integrations`
- `Billing`
- `Diagnostics`

### Admin Users

The Users section handles company and user provisioning.

Company creation:

- Enter company name, slug, and status.
- Slug auto-generates from company name until manually edited.
- Backend returns field-level validation errors for `companyName`, `slug`, `status`, duplicates, and invalid values.
- On success, the company is saved, inserted into shared company state, added to all relevant dropdowns, selected in Create User, and a toast says `Company created.`

User creation:

- Select company from the real backend company list.
- Enter name, username, password, confirm password, and status.
- Password minimum is 8 characters.
- Confirm password must match.
- Username must be unique.
- Selected `companyId` must exist.
- Backend returns field-level validation errors.
- On success, a toast confirms the user was created and the user table refreshes.

User table:

- Search users.
- Filter by company, status, and role.
- Reset user passwords.
- Activate or deactivate user accounts.
- Passwords are never shown.

### Admin Features

The Features section controls which modules company users can see and call.

Feature keys:

- `dashboard`
- `chats`
- `contacts_broadcasts`
- `campaigns`
- `ads`
- `ai_flows`
- `human_queue`
- `orders`
- `reports`
- `settings`

Feature toggles affect both UI navigation and API access. If a disabled API is called directly, it returns a clear feature-disabled error.

### Admin Integrations

The Integrations section stores per-company credentials.

Supported providers:

- Google Sheets
- WhatsApp
- Meta Ads

Secret fields:

- `googlePrivateKey`
- `whatsappAccessToken`
- `metaAdsAccessToken`

Encrypted database fields:

- `googlePrivateKeyEncrypted`
- `whatsappAccessTokenEncrypted`
- `metaAdsAccessTokenEncrypted`

Secret handling rules:

- Raw secrets are accepted only in save/test request bodies.
- Raw secrets are never returned by API responses.
- Raw secrets are never logged.
- Empty secret fields keep the saved encrypted value.
- Clear buttons remove saved encrypted values for the selected company only.
- The UI shows only safe status text:
  - Google: `Key saved`
  - WhatsApp: `Token saved`
  - Meta Ads: `Token saved`

Integration test rules:

- If the admin typed a new unsaved secret, the test uses the typed value.
- If no typed secret is present, the test uses the decrypted saved value.
- Google private keys normalize escaped `\n` into real newlines before use.
- Debug responses include safe booleans only:

```json
{
  "accessTokenProvidedInRequest": true,
  "savedAccessTokenExists": false,
  "privateKeyProvidedInRequest": false,
  "savedPrivateKeyExists": false,
  "encryptionKeyConfigured": true
}
```

Important errors:

- Missing encryption key while saving/decrypting secrets: `Encryption key missing. Add INTEGRATION_ENCRYPTION_KEY and restart server.`
- Decryption failure: `Saved secret cannot be decrypted. Clear and re-enter the credential.`
- Google Sheets missing fields: `Sheet ID missing.`, `Service account email missing.`, `Private key missing.`
- WhatsApp missing token: `WhatsApp access token missing.`
- Meta Ads missing token: `Meta Ads access token missing.`

### Admin Billing

Billing displays tracked API usage by company and date range.

Tracked providers:

- `META_WHATSAPP`
- `META_ADS`
- `CLAUDE`
- `GOOGLE_SHEETS`
- `INTERNAL`

The UI currently displays usage and exports CSV. Cost calculation is not finalized.

### Admin Diagnostics

Diagnostics show database and runtime readiness:

- Database connection status
- Migration readiness
- Required tables
- Company count
- User count
- Node version
- Prisma version
- Integration encryption key configured status through `/api/debug/integration-config`

## Company CRM Dashboard UI

The CRM dashboard is at `/dashboard` and is company-branded.

The top-left brand shows the logged-in user's company name and initials, not generic platform copy. The profile menu provides logout.

Dashboard navigation:

- `Command`
- `Inbox`
- `Audience`
- `Campaigns`
- `Ads`
- `AI Flows`
- `Takeover`
- `Orders`
- `Intel`
- `Settings`

Navigation is feature-gated per company. Disabled modules are hidden or rendered as setup-required states rather than broken screens.

### Dashboard Loading Behavior

The dashboard must load even when integrations are missing.

Rules:

- Dashboard reads and displays data.
- Dashboard is not required for automation to run.
- Missing integrations disable only the actions that need them.
- Skeleton loaders have fallback behavior so they do not stay forever.
- Integration setup-required messages appear inside relevant Google Sheets, WhatsApp, Meta Ads, campaign, broadcast, ads, and settings areas.
- A missing encryption key must not block login, dashboard loading, user creation, or normal non-secret reads.

### Command View

The Command view is the operational overview.

It shows:

- Operations pulse
- Hot leads
- Warm leads
- Low-intent leads
- Human queue count
- Completed/confirmed order count
- Audience momentum chart
- Lead quality distribution
- Response coverage
- Priority human queue
- Recent conversations
- Workspace insights

Primary actions:

- Import leads from Google Sheets
- Send initial WhatsApp welcome templates

These actions are disabled with setup-required messaging if Google Sheets or WhatsApp is not connected for the company.

### Inbox View

The Inbox view is the WhatsApp control room.

It includes:

- Conversation list with search
- Real message history sorted oldest to newest
- Separate inbound and outbound bubbles
- Selected lead profile
- AI insight
- Human attention card
- Order summary card
- Manual reply box
- Human takeover button
- New message indicator

Important UX rule:

The dashboard should preserve selected chat, scroll, and view state during polling or SSE updates. It should not reload the whole app or reset the selected thread unnecessarily.

### Audience View

The Audience view manages contacts and broadcasts.

Capabilities:

- Create contacts
- Search/filter contacts
- Import CSV contacts
- Import contacts from Google Sheets
- Select contacts
- Send approved WhatsApp template broadcasts
- Track broadcast jobs and recipient states

Broadcast sends are server-side jobs. The dashboard can close while jobs continue.

### Campaigns View

Campaign Studio creates scheduled or immediate WhatsApp template campaigns.

Audience sources:

- All contacts
- Tags
- Source segment
- CSV upload
- Google Sheets import
- Manually selected contacts

Campaign actions:

- Save campaign
- Run now
- Schedule campaign
- Pause campaign
- Cancel campaign
- Inspect recipients and reply counts

Campaigns require WhatsApp integration. Google Sheets audience sync requires Google Sheets integration.

### Ads View

Ads supports click-to-WhatsApp ad planning.

Capabilities:

- Meta Ads status check
- Create ad drafts
- Store audience, budget, location, headline, body, and opening WhatsApp message
- Preview ad draft content

The app does not publish live ads without valid Meta Ads credentials and deeper launch logic. Current behavior is planning and status verification.

### AI Flows View

AI Flows is a workflow builder for WhatsApp journeys.

Supported trigger types:

- Keyword
- Regex
- Template
- Ad

Common block types:

- Send message
- Wait for reply
- Condition
- Add tag
- Request human takeover

Workflow execution logs track started, executed, and failed states. Failed or uncertain paths can request human takeover.

### Takeover View

Takeover lists conversations needing manual attention.

It supports:

- Priority filtering
- Reason display
- Lead context
- Resolve action
- Links back to the live conversation

Human attention can be requested manually or by automation logic.

### Orders View

Orders shows extracted order summaries and operational status.

Tracked details:

- Customer
- Phone
- Product type
- Quantity
- Size
- Color
- GSM
- Customization
- Delivery location
- Notes
- Confidence score
- Order status

Order actions:

- Confirm order
- Mark ready for dispatch
- Mark dispatched
- Cancel order

Important logic:

Order actions send the WhatsApp customer message first. Only after a successful send does the order status update in the database.

### Intel View

Intel is the reports workspace for operational analysis.

It uses the same dashboard data surfaces for lead temperature, response coverage, conversation movement, orders, and usage-driven insight.

### Settings View

Settings shows account and company context, integration status, feature access, and knowledge controls.

Knowledge tools:

- List knowledge entries
- Create manual knowledge
- Edit and delete entries
- Ingest website content
- Sync configured Printwear website knowledge
- Upload PDF, DOCX, or TXT documents

## Core Workflows

### Company And User Provisioning

1. Admin opens `/admin`.
2. Admin creates a company.
3. Backend validates fields and duplicate slug.
4. Company is saved.
5. Frontend updates one shared company list.
6. Create User company dropdown re-renders and selects the new company.
7. Admin creates user with password and matching confirm password.
8. Backend hashes password and saves user.
9. User logs in and lands on `/dashboard`.
10. Dashboard brands itself with the user's company.

### Integration Save And Test

1. Admin selects a company in `/admin` -> Integrations.
2. Admin enters Google Sheets, WhatsApp, or Meta Ads values.
3. Save sends all non-secret and secret fields in the payload.
4. Backend encrypts secret values when present.
5. Empty secret fields preserve existing encrypted values.
6. API response returns only safe saved labels.
7. UI shows `Key saved` or `Token saved`.
8. Test buttons send currently typed values if present.
9. Backend test uses typed values first, otherwise decrypts saved values.
10. Test response returns provider status plus safe debug booleans.
11. Clear buttons clear encrypted fields for that company only.

### Google Sheets Import

1. User clicks Import on the Command view or contacts import from Audience/Campaigns.
2. Dashboard checks company integration status.
3. Backend resolves Google Sheets credentials:
   - company saved integration first
   - local env fallback only where allowed
4. Private key is normalized.
5. Service reads configured range.
6. Lead/contact rows are normalized.
7. Invalid rows are skipped.
8. Duplicates are avoided by company-scoped unique constraints.
9. Imported rows are stored in PostgreSQL.
10. Lead/contact views refresh.

Expected lead sheet columns:

| name | phone | status |
| --- | --- | --- |
| John | 919999999999 | new |

### Initial WhatsApp Welcome Send

1. User clicks Send welcomes.
2. Backend loads new leads for the user's company.
3. WhatsApp credentials are resolved for that company.
4. Approved template message is sent through Meta Cloud API.
5. Message and send log records are written.
6. Lead status updates to messaged or failed.
7. API usage is logged.
8. Dashboard refreshes operational counts.

### Manual WhatsApp Reply

1. User selects a chat.
2. User writes a reply.
3. Frontend sends message text to `/api/leads/:leadId/messages`.
4. Backend verifies feature access and company scope.
5. WhatsApp text message is sent.
6. Outbound message is persisted.
7. Lead temperature refreshes.
8. UI updates selected thread without resetting the full dashboard.

### Webhook And AI Reply Flow

1. Meta sends an inbound webhook to `/webhook`.
2. Webhook route acknowledges quickly.
3. Backend resolves company by WhatsApp phone number ID.
4. Lead is found or created by company and normalized phone.
5. Inbound message is saved and deduplicated by WhatsApp message ID.
6. Lead status changes to replied.
7. Lead score/temperature refreshes.
8. Human attention logic analyzes the inbound message.
9. Order summary refreshes from conversation history.
10. Knowledge base search retrieves relevant company context.
11. Claude drafts a concise reply when automation is allowed.
12. WhatsApp sends the reply.
13. Outbound message is saved.
14. SSE notifies open dashboards.

Dashboard presence is not required for webhook automation.

### Human Takeover

Human takeover can be triggered manually or by automation.

Flow:

1. Lead is marked as requiring human attention.
2. Priority and reason are stored.
3. Takeover queue updates.
4. Chat profile shows human attention state.
5. AI assist state changes to human in control.
6. User resolves the queue item when handled.

### Order Extraction And Actions

1. Inbound conversation text is analyzed.
2. Claude extraction tries to identify product, quantity, sizes, colors, GSM, customization, delivery location, notes, and confidence.
3. Structured parser fallback is used if Claude extraction fails.
4. `OrderSummary` is upserted for the lead.
5. Orders view groups records by status.
6. User can update fields or status.
7. Order action sends customer WhatsApp update first.
8. After send succeeds, order status is updated.

### Broadcasts

1. User imports or creates contacts.
2. User selects contacts.
3. User chooses an approved WhatsApp template.
4. Backend creates a `BulkMessageJob`.
5. Recipients are queued.
6. Server sends messages with throttling and status tracking.
7. Jobs report sent, failed, delivered, read, and queued counts.

### Campaigns

1. User creates a campaign.
2. Audience is resolved from contacts, tags, source, CSV, Google Sheets, or manual selection.
3. Campaign is scheduled or run immediately.
4. Recipients are persisted.
5. Server-side execution sends approved templates.
6. Status can be paused or cancelled.
7. Campaign detail tracks audience, sends, failures, and replies.

### Ad Drafts

1. User opens Ads.
2. Meta Ads status is checked if credentials exist.
3. User creates click-to-WhatsApp ad draft.
4. Draft stores targeting and creative fields.
5. No raw secret is exposed.

### AI Workflows

1. User builds a workflow with triggers and blocks.
2. Workflow definition is saved as JSON.
3. Matching inbound events can execute workflow logic.
4. Execution logs record outcomes.
5. Human fallback can be requested for failed or uncertain flows.

## API Endpoints

Public and auth:

- `GET /health`
- `GET /api/health`
- `GET /login`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /webhook`
- `POST /webhook`

Setup and diagnostics:

- `GET /api/automation/setup`
- `GET /api/debug/system-status`
- `GET /api/debug/database-schema`
- `GET /api/debug/integration-config`
- `GET /api/debug/google-sheets-status`
- `GET /api/debug/webhook-status`

Session and features:

- `GET /api/session`
- `GET /api/features/enabled`

Admin management:

- `GET /api/admin/companies`
- `POST /api/admin/companies`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:id`
- `POST /api/admin/users/:id/reset-password`
- `GET /api/admin/features`
- `PATCH /api/admin/features/:key`
- `GET /api/admin/billing`
- `GET /api/admin/billing/export`

Company integrations:

- `GET /api/admin/company-integrations`
- `PUT /api/admin/company-integrations`
- `DELETE /api/admin/company-integrations/:companyId/:provider`
- `POST /api/admin/company-integrations/:companyId/test/whatsapp`
- `POST /api/admin/company-integrations/:companyId/test/google-sheets`
- `POST /api/admin/company-integrations/:companyId/test/meta-ads`
- `GET /api/integrations/status`

Dashboard:

- `GET /api/dashboard`
- `GET /api/events`
- `GET /api/leads`
- `GET /api/leads/:leadId/conversation`
- `POST /api/leads/:leadId/messages`
- `POST /api/leads/import`
- `POST /api/messages/send-initial`

Contacts and broadcasts:

- `GET /api/contacts`
- `POST /api/contacts`
- `POST /api/contacts/import/csv`
- `POST /api/contacts/import/google-sheets`
- `GET /api/bulk-messages`
- `POST /api/bulk-messages`

Campaigns:

- `GET /api/campaigns`
- `POST /api/campaigns`
- `GET /api/campaigns/:campaignId`
- `POST /api/campaigns/:campaignId/pause`
- `POST /api/campaigns/:campaignId/cancel`

Ads:

- `GET /api/ads`
- `GET /api/ads/status`
- `POST /api/ads`

AI flows:

- `GET /api/ai-flows`
- `POST /api/ai-flows`
- `PATCH /api/ai-flows/:workflowId`

Knowledge:

- `POST /api/knowledge/seed`
- `GET /api/knowledge`
- `GET /admin/api/knowledge`
- `POST /admin/api/knowledge`
- `POST /admin/api/knowledge/ingest-url`
- `POST /admin/api/knowledge/sync-printwear`
- `POST /admin/api/knowledge/upload`
- `PUT /admin/api/knowledge/:id`
- `DELETE /admin/api/knowledge/:id`

Human takeover:

- `GET /api/human-action-queue`
- `POST /api/human-action-queue/:leadId/request`
- `POST /api/human-action-queue/:leadId/resolve`

Orders:

- `GET /api/order-pipeline`
- `PATCH /api/orders/:orderId/status`
- `PATCH /api/orders/:orderId`
- `POST /api/orders/:orderId/action`

Admin compatibility APIs under `/admin/api`:

- `GET /admin/api/events`
- `GET /admin/api/overview`
- `GET /admin/api/human-action-queue`
- `POST /admin/api/human-action-queue/:leadId/request`
- `POST /admin/api/human-action-queue/:leadId/resolve`
- `GET /admin/api/order-pipeline`
- `PATCH /admin/api/orders/:orderId/status`
- `PATCH /admin/api/orders/:orderId`
- `POST /admin/api/orders/:orderId/action`
- `GET /admin/api/leads`
- `GET /admin/api/leads/:leadId/conversation`
- `POST /admin/api/leads/:leadId/messages`
- `POST /admin/api/actions/import-leads`
- `POST /admin/api/actions/send-initial`
- `GET /admin/api/logs`
- `GET /admin/api/enums`

## Feature Gating

Feature access is enforced in two places:

1. Frontend navigation hides disabled sections.
2. Backend `requireFeature(...)` blocks disabled module APIs.

Mapping:

- Command overview and imports: `dashboard`
- Inbox, leads, manual replies, SSE: `chats`
- Audience and broadcasts: `contacts_broadcasts`
- Campaign studio: `campaigns`
- Ads: `ads`
- AI workflow builder: `ai_flows`
- Takeover queue: `human_queue`
- Order desk: `orders`
- Reports: `reports`
- Settings, knowledge, debug webhook status: `settings`

Admins can manage feature access and are not meant to be blocked from admin tooling.

## Integration Security

Secrets are encrypted with AES-256-GCM using a SHA-256 hash of `INTEGRATION_ENCRYPTION_KEY`.

Saved encrypted fields include version, IV, tag, and ciphertext:

```txt
v1:<iv-base64>:<tag-base64>:<ciphertext-base64>
```

Rules:

- Saving a non-empty secret requires `INTEGRATION_ENCRYPTION_KEY`.
- Decrypting a saved secret requires `INTEGRATION_ENCRYPTION_KEY`.
- Empty secret inputs preserve existing encrypted values.
- Clear provider endpoints set the provider encrypted field to null.
- API responses expose only saved labels and debug booleans.
- Logs must not include raw credentials.

Debug config endpoint:

```http
GET /api/debug/integration-config
```

Response:

```json
{
  "integrationEncryptionKeyConfigured": true,
  "nodeVersion": "v22.x.x",
  "environment": "development"
}
```

## Webhook Setup

Configure Meta WhatsApp callback URL:

```txt
https://YOUR_PUBLIC_DOMAIN/webhook
```

Use `WHATSAPP_VERIFY_TOKEN` or the per-company saved verify token as the Meta verification token.

Webhook behavior:

- `GET /webhook`: handles Meta verification challenge.
- `POST /webhook`: processes inbound messages and delivery/read statuses.
- Webhook response returns quickly.
- Processing continues server-side.
- Duplicate inbound messages are ignored using WhatsApp message ID uniqueness.
- Status webhooks update outbound messages when possible.

For local testing, use any HTTPS tunnel that points to port `3000`.

## Knowledge Base And Claude Logic

Knowledge entries are company-scoped.

Sources:

- Manual
- Website
- Upload
- Seed

Retrieval:

- Uses PostgreSQL search where available.
- Falls back to basic matching when needed.
- Limits retrieved entries before prompting Claude.

Claude responsibilities:

- Draft concise WhatsApp-style replies from company context.
- Avoid inventing facts outside retrieved knowledge.
- Say the team will confirm when the answer is not known.
- Extract order details from conversation text.
- Support workflow and automation decisions where implemented.

## Lead Scoring Logic

Lead temperature is refreshed from conversation depth and intent signals.

Baseline message-count rules:

- `HOT`: 6 or more messages
- `WARM`: 2 to 5 messages
- `SCRAP`: fewer than 2 messages

Additional scoring logic can incorporate keywords and intent phrases related to orders, bulk orders, quotations, delivery, and purchase readiness.

## Reliability And Fallbacks

- Duplicate leads are prevented by company-scoped phone uniqueness.
- Duplicate Google Sheet rows are guarded by company-scoped row uniqueness.
- Duplicate inbound WhatsApp messages are prevented by WhatsApp message ID uniqueness.
- Webhook processing is backend-first and does not depend on open browser dashboards.
- Dashboard polling and SSE should update targeted state without full reloads.
- Missing integrations should produce disabled controls and setup-required messages, not blank pages.
- Skeleton loaders have fallbacks.
- External API errors are translated into friendly messages where possible.
- API usage logging failures should not break the core user action.
- Integration test endpoints return safe diagnostics without exposing secrets.

## UI And UX Principles

Platform admin:

- Platform-neutral branding.
- Dense, practical SaaS admin controls.
- Compact user table with filters.
- Clear field-level validation.
- Toasts for success and failure.
- No password display.
- No secret display.

Company dashboard:

- Company-branded shell.
- Work-focused command center, not a landing page.
- Navigation maps to real workflows.
- Missing integrations disable only dependent actions.
- Chat view preserves selected thread and scroll behavior.
- Buttons use icons and clear action labels.
- Tables and cards are optimized for scanning.
- Empty states explain what is missing without blocking unrelated modules.
- Settings and diagnostics surface setup status without exposing secrets.

## Validation Behavior

Admin company creation returns exact field-level errors for:

- company name
- slug
- status
- duplicate company name
- duplicate company slug

Admin user creation returns exact field-level errors for:

- username
- password
- confirm password
- status
- duplicate username
- invalid or missing company

Frontend displays errors near fields and in the banner. It must not show only `Validation failed`.

Development-only logging may log validation response metadata:

```js
console.log("Validation error", response)
```

Do not log secrets.

## Common Errors

- `Encryption key missing. Add INTEGRATION_ENCRYPTION_KEY and restart server.`: add a valid `INTEGRATION_ENCRYPTION_KEY`, restart, then save or test encrypted credentials again.
- `Saved secret cannot be decrypted. Clear and re-enter the credential.`: saved encrypted data does not match the current encryption key or is corrupted.
- `Private key missing.`: Google Sheets test/import has no typed private key and no saved private key.
- `Invalid private key format.`: Google private key is not a valid PEM service account private key.
- `Google Sheets permission denied...`: share the sheet with the service account email and grant Editor access.
- `Google Sheet not found...`: check sheet ID and sharing.
- `Google Sheets API disabled...`: enable Google Sheets API in the Google Cloud project.
- `WhatsApp access token missing.`: save or type a WhatsApp access token before testing or sending.
- `Meta Ads access token missing.`: save or type a Meta Ads access token before testing.
- `Feature disabled by admin.`: enable the module in Admin -> Features.
- `Invalid username or password`: login failed or user is inactive.

## Manual Verification Checklist

Admin company/user:

- Create company `ABC Uniforms`.
- Confirm it appears in Create User company dropdown immediately.
- Confirm it is automatically selected.
- Create a user with 8+ character password.
- Log in as the user.
- Confirm dashboard loads and top-left shows `ABC Uniforms`.

Integration secrets:

- Enter Google private key.
- Save.
- Confirm UI changes from `No key saved.` to `Key saved`.
- Click Test Google Sheets.
- Confirm missing-key error is gone if key was provided.
- Enter WhatsApp access token.
- Save.
- Confirm UI changes from `No token saved.` to `Token saved`.
- Click Test WhatsApp.
- Confirm debug response has `accessTokenProvidedInRequest` true when using typed token or `savedAccessTokenExists` true when using saved token.
- Enter Meta Ads access token.
- Save.
- Confirm UI changes to `Token saved`.
- Click Test Meta Ads.
- Clear each provider and confirm saved labels return to unsaved states.

Dashboard:

- Log in as company user.
- Confirm dashboard loads even when integrations are missing.
- Confirm integration-dependent actions show setup-required messages.
- Confirm Inbox loads real chat history without replacing history with only the latest message.
- Confirm selecting a chat is preserved during refresh/poll.
- Confirm manual WhatsApp reply sends and appears in history.

Build:

```bash
cmd /c npm run build
node --check public\assets\admin.js
node --check public\assets\dashboard.js
```

## Deployment Notes

- Run with Node 22.
- Set `DATABASE_URL`.
- Set `SESSION_SECRET`.
- Set `INTEGRATION_ENCRYPTION_KEY` before saving company integration secrets.
- Run Prisma migrations before starting the app.
- Confirm startup diagnostics show the expected company/user counts and integration encryption key configured status.
- Configure Meta webhook callback to `/webhook`.
- Keep raw provider secrets out of logs and screenshots.

## Development Notes

- Prefer `rg` for search.
- Keep frontend changes in `public/*.html`, `public/assets/*.js`, and `public/assets/styles.css`.
- Keep dashboard browser JS compatible with direct script loading.
- Run `node --check` for edited browser JavaScript because `tsc` does not typecheck it.
- Avoid unrelated refactors when fixing production workflow bugs.
- Keep tenant scoping explicit through `companyId`.
- Keep admin surfaces platform-neutral and user dashboard surfaces company-branded.
