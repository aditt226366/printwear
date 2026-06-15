# WhatsApp Messaging Automation Backend

Phase 1 backend for importing leads from Google Sheets, sending WhatsApp template messages through Meta WhatsApp Cloud API, receiving webhook replies, generating short Claude-powered responses from a simple knowledge base, and storing all messaging activity in PostgreSQL.

## Tech Stack

- Node.js 20-23, Express.js, TypeScript
- PostgreSQL with Prisma ORM
- Google Sheets API
- Meta WhatsApp Cloud API
- Claude Messages API
- PostgreSQL full-text search for Phase 1 knowledge retrieval
- Pino structured logging

## Runtime

Use Node 22 for local preview and production. Do not use Node 24 because Prisma TLS connections to Supabase may fail in this environment.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env`:

   ```bash
   cp .env.example .env
   ```

3. Fill required values in `.env`.

4. Create and migrate the database:

   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   ```

5. Seed sample knowledge base content:

   ```bash
   npm run seed
   ```

6. Start development server:

   ```bash
   npm run dev
   ```

7. Check health:

   ```bash
   curl http://localhost:3000/health
   ```

   Expected response:

   ```json
   { "status": "ok" }
   ```

## Environment Variables

See `.env.example`.

- `ADMIN_USERNAME`: Username for the first database admin, default `admin`.
- `ADMIN_EMAIL`: Email for the first database admin.
- `ADMIN_PASSWORD`: Password used only to seed the first database admin. Use a strong password before sharing the service.
- `ADMIN_NAME`: Display name for the first database admin.
- `USER_USERNAME`: Optional default CRM user username.
- `USER_EMAIL`: Optional default CRM user email.
- `USER_PASSWORD`: Optional default CRM user password.
- `USER_NAME`: Optional default CRM user display name.
- `SESSION_SECRET`: Long random string used to sign admin sessions.
- `DATABASE_URL`: PostgreSQL connection string.
- `WHATSAPP_PHONE_NUMBER_ID`: Meta WhatsApp phone number ID.
- `WHATSAPP_BUSINESS_ACCOUNT_ID`: Meta WhatsApp business account ID.
- `WHATSAPP_ACCESS_TOKEN`: Meta access token with WhatsApp messaging permissions.
- `WHATSAPP_VERIFY_TOKEN`: Shared token used for webhook verification.
- `WHATSAPP_TEMPLATE_NAME`: Approved template name in Meta.
- `WHATSAPP_TEMPLATE_LANGUAGE`: Template language code, default `en_US`.
- `ANTHROPIC_API_KEY`: Claude API key.
- `CLAUDE_MODEL`: Claude model, default `claude-sonnet-4-6`.
- `GOOGLE_SHEETS_ID`: Spreadsheet ID.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: Google service account email.
- `GOOGLE_PRIVATE_KEY`: Google service account private key. Keep escaped newlines as `\n`.
- `LOG_LEVEL`: Pino log level.

Optional supported values:

- `WHATSAPP_API_VERSION`: Meta Graph API version, default `v20.0`.
- `GOOGLE_SHEETS_RANGE`: Sheet range, default `Sheet1!A:C`.
- `GOOGLE_SHEETS_STATUS_COLUMN`: Status column, default `C`.
- `META_AD_ACCOUNT_ID`: Meta Ads account ID used to verify Ads API connectivity.
- `META_ADS_ACCESS_TOKEN`: Meta token used only for Ads status/insights calls.

## Database

The Prisma schema creates:

- `Lead`: imported or inbound WhatsApp leads, deduplicated by phone.
- `Message`: inbound and outbound WhatsApp messages, deduplicated by WhatsApp message ID.
- `KnowledgeBase`: simple company knowledge content.
- `SendLog`: send attempts and failures.
- `Company`: tenant/company records for CRM users.
- `AppUser`: bcrypt-hashed admin and user accounts.
- `CompanyFeature`: company-level feature visibility toggles.
- `ApiUsageLog`: tracked WhatsApp, Meta Ads, Claude, Google Sheets, and internal calls.
- `BillingSnapshot`: optional period summaries for billing exports.

Lead temperature is refreshed from total message count:

- `6+` messages: hot
- `2 to 5` messages: warm
- below `2`: scrap

## Google Sheets Setup

1. Create a Google Cloud service account.
2. Enable Google Sheets API.
3. Share the target Google Sheet with the service account email.
4. Use columns:

   | name | phone | status |
   | --- | --- | --- |
   | John | 919999999999 | new |

5. Add the spreadsheet ID and service account credentials to `.env`.

`POST /api/leads/import` reads rows where `status` is `new`, normalizes phone numbers, skips invalid rows, prevents duplicate leads, and stores new leads in PostgreSQL.

## Meta WhatsApp Setup

1. Create or select a Meta app with WhatsApp enabled.
2. Add `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, and `WHATSAPP_ACCESS_TOKEN` to `.env`.
3. Create and approve a template matching `WHATSAPP_TEMPLATE_NAME`.
4. Configure webhook callback URL:

   ```txt
   https://YOUR_NGROK_DOMAIN/webhook
   ```

5. Use `WHATSAPP_VERIFY_TOKEN` as the webhook verify token.

`GET /webhook` handles Meta verification. `POST /webhook` handles incoming customer messages and delivery status updates.

## Claude Setup

Add `ANTHROPIC_API_KEY` to `.env`. The Claude service prompts the model to act as a short, polite sales assistant for XYZ Company and to answer only from retrieved knowledge base context. If knowledge is missing, it should say the team will confirm.

## API Endpoints

- `GET /health`: health check.
- `POST /api/leads/import`: import new leads from Google Sheets.
- `POST /api/messages/send-initial`: send the approved WhatsApp template to new leads.
- `POST /api/knowledge/seed`: seed default company knowledge.
- `GET /api/knowledge`: list knowledge base entries.
- `GET /webhook`: Meta webhook verification.
- `POST /webhook`: incoming WhatsApp messages and status updates.

## Login, Admin, and User Access

The app uses one login page for both admins and users:

- `GET /login`: single username/password login screen.
- `POST /auth/login`: validates a database user by username or email.
- `GET /admin`: admin-only panel for users, features, and billing.
- `GET /dashboard`: protected CRM dashboard for CRM users.
- `POST /logout`: clears the admin session.

Set these values before first startup or seed:

```env
ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this-password
ADMIN_NAME=Admin
SESSION_SECRET=use-a-long-random-secret-at-least-32-characters
```

On startup, the server creates a database admin from the admin env values only if no admin exists. Passwords are never stored in plain text; `AppUser.passwordHash` stores a bcrypt hash. Optional `USER_*` env values seed a default user assigned to the default `Printwear` company.

After login:

- Admin credentials redirect to `/admin`.
- User credentials redirect to `/dashboard`.
- Inactive users cannot log in.
- Failed logins return the same generic error: `Invalid username or password`.

## Admin Panel

The admin panel has three sections:

- `Users`: create companies, create users, reset passwords, and activate/deactivate users.
- `Features`: select a company and control visible CRM features with ON/OFF toggles.
- `Billing`: review internal tracked API calls and export usage as CSV.

Admin-only APIs:

- `GET /api/admin/companies`
- `POST /api/admin/companies`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:id`
- `POST /api/admin/users/:id/reset-password`
- `GET /api/admin/features?companyId=...`
- `PATCH /api/admin/features/:id`
- `GET /api/admin/billing`
- `GET /api/admin/billing/export`

## Feature Toggles

Feature toggles are stored per company in `CompanyFeature`. Admins always see admin tools and can access the CRM dashboard. CRM users only see enabled features for their company.

Supported feature keys:

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

Disabled features are hidden from the user dashboard navigation. If a user calls a disabled feature API directly, the API returns `Feature disabled by admin.`

## CRM Dashboard

The dashboard includes:

- Simple business overview with total leads, replied leads, failed leads, and hot leads.
- Pipeline status for new, welcomed, and replied leads.
- Lead list with WhatsApp conversation view.
- Manual WhatsApp reply box for selected leads.
- Google Sheets import button.
- Initial welcome template send button.
- Knowledge base editor for the WhatsApp assistant's company context.
- Manual knowledge entry, website URL ingestion, and PDF/DOCX/TXT upload.
- `Sync Website Knowledge` button for refreshing Printwear content from `PRINTWEAR_WEBSITE_URL`.
- Activity log for sends and failures.

For Printwear, these optional values control website ingestion:

```env
PRINTWEAR_WEBSITE_URL=https://printwear.in
KNOWLEDGE_CRAWL_MAX_PAGES=12
KNOWLEDGE_CHUNK_SIZE=1200
```

After setting `DATABASE_URL`, run:

```bash
npm run prisma:migrate
npm run seed
```

The seed command creates or updates `Printwear Company Product Knowledge` in the database.

## Billing and API Usage

External service wrappers write usage rows to `ApiUsageLog`:

- WhatsApp Cloud API sends/templates: `META_WHATSAPP`
- Meta Ads status/insights calls: `META_ADS`
- Claude model calls: `CLAUDE`
- Google Sheets reads/updates: `GOOGLE_SHEETS`
- Bulk jobs and campaign execution events: `INTERNAL`

The admin Billing page labels usage as internal tracked usage. Meta Ads account status and future insights use `META_AD_ACCOUNT_ID` and `META_ADS_ACCESS_TOKEN` when configured, but the app does not launch ads without valid API credentials.

## Local Webhook Testing With ngrok

1. Run the server:

   ```bash
   npm run dev
   ```

2. Start ngrok:

   ```bash
   ngrok http 3000
   ```

3. In Meta webhook settings, set callback URL to:

   ```txt
   https://YOUR_NGROK_DOMAIN/webhook
   ```

4. Use the same verify token as `WHATSAPP_VERIFY_TOKEN`.

## Reliability Notes

- Duplicate leads are prevented by a unique phone number.
- Duplicate inbound webhooks are prevented by unique WhatsApp message IDs.
- Status webhooks update stored outbound messages by WhatsApp message ID.
- WhatsApp sends include timeout handling and retry for network, rate limit, and server failures.
- Webhook responses return immediately, then processing continues in the background so Meta is not blocked by Claude or WhatsApp latency.
- Errors are logged with Pino and stored in `SendLog` where relevant.
- Missing API environment variables fail at service call time with clear errors instead of crashing `/health`.

## Common Errors

- `Missing required environment variable`: Fill the related `.env` value before using that integration.
- `Google Sheet must contain name, phone, and status columns`: Check the first row headers.
- `Webhook verification failed`: Confirm Meta verify token matches `WHATSAPP_VERIFY_TOKEN`.
- `WhatsApp API failed`: Check access token, phone number ID, approved template name, and recipient phone format.
- `Claude API returned an empty reply`: Check API key, model name, and Anthropic account access.
