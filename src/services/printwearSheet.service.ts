import { google } from "googleapis";
import { LeadStatus } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/errors.js";
import { normalizePhoneNumber } from "../utils/phone.js";
import { apiUsageService } from "./apiUsage.service.js";
import { printwearIntegrationService } from "./printwearIntegration.service.js";
import { printwearLeadScoringService } from "./printwearLeadScoring.service.js";

const REQUIRED_COLUMNS = ["name", "phone", "opt_in", "source"];
const SYSTEM_COLUMNS = [
  "crmContactId",
  "crmConversationId",
  "templateStatus",
  "templateSentAt",
  "messageStatus",
  "customerReplyCount",
  "leadTemperature",
  "lastCustomerMessage",
  "lastAIReply",
  "orderStatus",
  "humanQueueStatus",
  "lastSyncedAt",
  "error"
];

type SheetClient = {
  spreadsheetId: string;
  sheetName: string;
  sheets: ReturnType<typeof google.sheets>;
};

type SheetRow = {
  rowNumber: number;
  values: unknown[];
  record: Record<string, string>;
};

function normalizePrivateKey(value: string) {
  return value.trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n");
}

function normalizeHeader(value: unknown) {
  return String(value ?? "").trim();
}

function headerKey(value: unknown) {
  return normalizeHeader(value).toLowerCase().replace(/[\s_-]+/g, "");
}

function truthyOptIn(value: string) {
  return ["true", "yes", "y", "1", "optin", "opted in", "allowed"].includes(value.trim().toLowerCase());
}

function columnIndexToLetter(index: number) {
  let letter = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    value = Math.floor((value - 1) / 26);
  }
  return letter;
}

function sheetNameFromRange(range = env.GOOGLE_SHEETS_RANGE) {
  return range.split("!")[0] || "Sheet1";
}

async function clientFor(tenantId: string): Promise<SheetClient> {
  const config = await printwearIntegrationService.getGoogleSheetsConfig(tenantId);
  const auth = new google.auth.JWT({
    email: config.serviceAccountEmail,
    key: normalizePrivateKey(config.privateKey),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return {
    spreadsheetId: config.spreadsheetId,
    sheetName: sheetNameFromRange(),
    sheets: google.sheets({ version: "v4", auth })
  };
}

function normalizeHeaders(headers: unknown[]) {
  const next = headers.map(normalizeHeader).filter(Boolean);
  for (const column of [...REQUIRED_COLUMNS, ...SYSTEM_COLUMNS]) {
    if (!next.some((header) => headerKey(header) === headerKey(column))) next.push(column);
  }
  return next;
}

function indexFor(headers: string[], column: string) {
  return headers.findIndex((header) => headerKey(header) === headerKey(column));
}

function rowRecord(headers: string[], values: unknown[]) {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = String(values[index] ?? "").trim();
  });
  return record;
}

function valueFor(record: Record<string, string>, aliases: string[]) {
  const normalized = Object.fromEntries(Object.entries(record).map(([key, value]) => [headerKey(key), value]));
  for (const alias of aliases) {
    const value = normalized[headerKey(alias)];
    if (value) return value;
  }
  return "";
}

async function readRows(tenantId: string) {
  const client = await clientFor(tenantId);
  const response = await client.sheets.spreadsheets.values.get({
    spreadsheetId: client.spreadsheetId,
    range: `${client.sheetName}!A:AZ`
  });
  const rawRows = response.data.values ?? [];
  const headers = normalizeHeaders(rawRows[0] ?? []);

  if (!rawRows.length || headers.length !== (rawRows[0] ?? []).length) {
    await client.sheets.spreadsheets.values.update({
      spreadsheetId: client.spreadsheetId,
      range: `${client.sheetName}!A1:${columnIndexToLetter(headers.length - 1)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] }
    });
  }

  const rows: SheetRow[] = rawRows.slice(1).map((values, index) => ({
    rowNumber: index + 2,
    values,
    record: rowRecord(headers, values)
  }));

  void apiUsageService.log({
    companyId: tenantId,
    provider: "GOOGLE_SHEETS",
    endpoint: "printwear.spreadsheets.values.get",
    method: "GET",
    statusCode: 200,
    success: true,
    metadata: { range: `${client.sheetName}!A:AZ`, rowCount: rows.length }
  });

  return { client, headers, rows };
}

async function writeRowPatch(client: SheetClient, headers: string[], rowNumber: number, patch: Record<string, unknown>) {
  const data = Object.entries(patch)
    .map(([column, value]) => {
      const index = indexFor(headers, column);
      if (index === -1) return null;
      return {
        range: `${client.sheetName}!${columnIndexToLetter(index)}${rowNumber}`,
        values: [[value === null || value === undefined ? "" : String(value)]]
      };
    })
    .filter((item): item is { range: string; values: string[][] } => item !== null);

  if (!data.length) return;

  await client.sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: client.spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data
    }
  });
}

async function patchLeadSheetRow(tenantId: string, leadId: string, patch: Record<string, unknown>) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId: tenantId },
    select: { googleSheetRowNumber: true }
  });
  if (!lead?.googleSheetRowNumber) return false;
  const { client, headers } = await readRows(tenantId);
  await writeRowPatch(client, headers, lead.googleSheetRowNumber, {
    ...patch,
    lastSyncedAt: new Date().toISOString()
  });
  return true;
}

export const printwearSheetService = {
  async syncLeads(tenantId: string) {
    const { client, headers, rows } = await readRows(tenantId);
    const missingRequired = REQUIRED_COLUMNS.filter((column) => indexFor(headers, column) === -1);
    if (missingRequired.length) {
      throw new AppError(`Google Sheet missing columns: ${missingRequired.join(", ")}`, 400);
    }

    let imported = 0;
    let linkedDuplicates = 0;
    let skippedMissingOptIn = 0;
    let skippedInvalidPhone = 0;
    const results = [];

    for (const row of rows) {
      const name = valueFor(row.record, ["name", "full_name", "customer_name"]) || "Unknown";
      const rawPhone = valueFor(row.record, ["phone", "mobile", "whatsapp", "whatsapp_number"]);
      const optIn = valueFor(row.record, ["opt_in", "optin", "consent"]);
      const source = valueFor(row.record, ["source"]) || "GOOGLE_SHEET";
      const productInterest = valueFor(row.record, ["product_interest"]);
      const city = valueFor(row.record, ["city"]);
      const now = new Date().toISOString();

      if (!truthyOptIn(optIn)) {
        skippedMissingOptIn += 1;
        await writeRowPatch(client, headers, row.rowNumber, {
          status: "Skipped",
          error: "Missing opt-in",
          lastSyncedAt: now
        });
        results.push({ rowNumber: row.rowNumber, status: "skipped", error: "Missing opt-in" });
        continue;
      }

      const phone = normalizePhoneNumber(rawPhone);
      if (!phone) {
        skippedInvalidPhone += 1;
        await writeRowPatch(client, headers, row.rowNumber, {
          status: "Skipped",
          error: "Invalid phone number",
          lastSyncedAt: now
        });
        results.push({ rowNumber: row.rowNumber, status: "skipped", error: "Invalid phone number" });
        continue;
      }

      const existing = await prisma.lead.findUnique({
        where: { companyId_phone: { companyId: tenantId, phone } },
        include: { orderSummary: true }
      });
      const lead = existing
        ? await prisma.lead.update({
            where: { id: existing.id },
            data: {
              name: name.trim() || existing.name,
              source: source || existing.source,
              status: existing.status,
              temperatureReason: existing.temperatureReason || "0-1 inbound customer replies"
            }
          })
        : await prisma.lead.create({
            data: {
              companyId: tenantId,
              name: name.trim() || "Unknown",
              phone,
              source: source || "GOOGLE_SHEET",
              status: LeadStatus.NEW,
              googleSheetRowNumber: row.rowNumber,
              leadTemperature: "SCRAP",
              temperatureReason: "0-1 inbound customer replies"
            }
          });

      await printwearLeadScoringService.recalculateLeadTemperature(lead.id);
      if (existing) linkedDuplicates += 1;
      else imported += 1;

      await writeRowPatch(client, headers, row.rowNumber, {
        crmContactId: lead.id,
        crmConversationId: lead.id,
        status: existing ? "Duplicate linked" : "Imported",
        leadTemperature: "SCRAP",
        customerReplyCount: lead.messageCount,
        error: "",
        lastSyncedAt: now
      });
      results.push({
        rowNumber: row.rowNumber,
        leadId: lead.id,
        name,
        phone,
        source,
        productInterest,
        city,
        status: existing ? "Duplicate linked" : "Imported"
      });
    }

    return {
      scanned: rows.length,
      imported,
      duplicates: linkedDuplicates,
      invalidRows: skippedInvalidPhone + skippedMissingOptIn,
      missingOptIn: skippedMissingOptIn,
      invalidPhone: skippedInvalidPhone,
      rows: results
    };
  },

  async updateLeadRow(tenantId: string, leadId: string, patch: Record<string, unknown>) {
    return patchLeadSheetRow(tenantId, leadId, patch);
  },

  async updateMessageStatus(tenantId: string, leadId: string, status: string, error?: string) {
    return patchLeadSheetRow(tenantId, leadId, {
      messageStatus: status,
      error: error ?? ""
    });
  },

  async updateOrderStatus(tenantId: string, leadId: string, status: string) {
    return patchLeadSheetRow(tenantId, leadId, { orderStatus: status });
  },

  async updateHumanQueueStatus(tenantId: string, leadId: string, status: string) {
    return patchLeadSheetRow(tenantId, leadId, { humanQueueStatus: status });
  }
};
