# WhatsApp Messaging Automation Backend

Phase 1 backend for importing leads from Google Sheets, sending WhatsApp template messages through Meta WhatsApp Cloud API, receiving webhook replies, generating short Claude-powered responses from a simple knowledge base, and storing all messaging activity in PostgreSQL.

## Tech Stack

- Node.js, Express.js, TypeScript
- PostgreSQL with Prisma ORM
- Google Sheets API
- Meta WhatsApp Cloud API
- Claude Messages API
- PostgreSQL full-text search for Phase 1 knowledge retrieval
- Pino structured logging

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

- `ADMIN_EMAIL`: Login email for the single admin user.
- `ADMIN_PASSWORD`: Login password for the single admin user. Use a strong password before sharing the service.
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

## Database

The Prisma schema creates:

- `Lead`: imported or inbound WhatsApp leads, deduplicated by phone.
- `Message`: inbound and outbound WhatsApp messages, deduplicated by WhatsApp message ID.
- `KnowledgeBase`: simple company knowledge content.
- `SendLog`: send attempts and failures.

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

## Admin Dashboard

Phase 2 adds a single-admin dashboard:

- `GET /login`: admin login screen.
- `GET /dashboard`: protected dashboard.
- `POST /logout`: clears the admin session.
- `/admin/api/*`: protected dashboard API.

Set these values before using it:

```env
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-this-password
SESSION_SECRET=use-a-long-random-secret-at-least-32-characters
```

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
