import { google } from "googleapis";
import { env, requireEnv } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { normalizePhoneNumber } from "../utils/phone.js";

export type SheetLead = {
  name: string;
  phone: string;
  rowNumber: number;
};

function normalizeHeader(value: unknown) {
  return String(value).trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function findHeaderIndex(headers: string[], aliases: string[]) {
  return headers.findIndex((header) => aliases.includes(header));
}

function normalizePrivateKey(value: string) {
  return value.trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n");
}

export function validateGoogleSheetsConfig() {
  const missing = [
    "GOOGLE_SHEETS_ID",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_PRIVATE_KEY"
  ].filter((name) => !String(env[name as keyof typeof env] ?? "").trim());

  if (missing.length) {
    throw new AppError("Google Sheets configuration is incomplete", 400, `Missing ${missing.join(", ")}`);
  }

  const key = normalizePrivateKey(requireEnv("GOOGLE_PRIVATE_KEY"));
  if (!key.includes("-----BEGIN PRIVATE KEY-----") || !key.includes("-----END PRIVATE KEY-----")) {
    throw new AppError(
      "Google Sheets access failed",
      400,
      "Missing GOOGLE_PRIVATE_KEY or invalid private key format"
    );
  }

  return {
    spreadsheetId: requireEnv("GOOGLE_SHEETS_ID"),
    serviceAccountEmail: requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    privateKey: key
  };
}

function getAuthClient() {
  const config = validateGoogleSheetsConfig();
  logger.info({ serviceAccountEmail: config.serviceAccountEmail }, "Creating Google Sheets auth client");

  return new google.auth.JWT({
    email: config.serviceAccountEmail,
    key: config.privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
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

export const googleSheetsService = {
  async getNewLeads(): Promise<SheetLead[]> {
    logger.info({ range: env.GOOGLE_SHEETS_RANGE }, "Starting Google Sheets lead read");
    const sheets = google.sheets({ version: "v4", auth: getAuthClient() });
    const spreadsheetId = requireEnv("GOOGLE_SHEETS_ID");
    let response;

    try {
      logger.info({ spreadsheetId, range: env.GOOGLE_SHEETS_RANGE }, "Reading Google Sheets values");
      response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: env.GOOGLE_SHEETS_RANGE
      });
    } catch (error) {
      const sheetsError = error as { code?: number; status?: number };
      const status = sheetsError.code ?? sheetsError.status;
      logger.error({ error, status }, "Google Sheets read failed");

      if (status === 403) {
        const serviceAccountEmail = requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
        throw new AppError(
          `Google Sheets permission denied. Share this spreadsheet with ${serviceAccountEmail} and give it Editor access.`,
          400
        );
      }

      if (status === 404) {
        throw new AppError("Google Sheet not found. Check GOOGLE_SHEETS_ID and GOOGLE_SHEETS_RANGE in .env.", 400);
      }

      throw new AppError(
        "Google Sheets access failed",
        500,
        error instanceof Error ? error.message : "Unknown Google Sheets error"
      );
    }

    const rows = response.data.values ?? [];
    logger.info({ rowCount: rows.length }, "Google Sheets values read");
    if (rows.length < 2) {
      return [];
    }

    const headers = rows[0].map(normalizeHeader);
    const nameIndex = findHeaderIndex(headers, ["name", "fullname", "customername"]);
    const phoneIndex = findHeaderIndex(headers, ["phone", "number", "phonenumber", "mobile", "mobilenumber", "whatsapp", "whatsappnumber"]);
    const statusIndex = findHeaderIndex(headers, ["status", "leadstatus"]);

    if (nameIndex === -1 || phoneIndex === -1 || statusIndex === -1) {
      throw new AppError("Google Sheet format is invalid", 400, "Google Sheet must contain name, phone/number, and status columns");
    }

    const leads = rows
      .slice(1)
      .map((row, index) => {
        const rowNumber = index + 2;
        const phone = normalizePhoneNumber(row[phoneIndex]);
        const status = String(row[statusIndex] ?? "").trim().toLowerCase();

        if (!phone || (status && status !== "new")) {
          return null;
        }

        return {
          name: String(row[nameIndex] ?? "").trim() || "Unknown",
          phone,
          rowNumber
        };
      })
      .filter((lead): lead is SheetLead => lead !== null);

    logger.info({ matchingNewLeadRows: leads.length, dataRows: rows.length - 1 }, "Google Sheets lead rows filtered");
    return leads;
  },

  async updateLeadStatus(rowNumber: number, status: string) {
    logger.info({ rowNumber, status }, "Updating Google Sheets lead status");
    const sheets = google.sheets({ version: "v4", auth: getAuthClient() });
    const spreadsheetId = requireEnv("GOOGLE_SHEETS_ID");
    const sheetName = env.GOOGLE_SHEETS_RANGE.split("!")[0] || "Sheet1";
    const statusColumn = env.GOOGLE_SHEETS_STATUS_COLUMN || columnIndexToLetter(2);

    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!${statusColumn}${rowNumber}`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[status]]
        }
      });
      logger.info({ rowNumber, status }, "Google Sheets lead status updated");
    } catch (error) {
      logger.error({ error, rowNumber, status }, "Google Sheets status update failed");
      throw new AppError(
        "Google Sheets update failed",
        500,
        error instanceof Error ? error.message : "Unknown Google Sheets update error"
      );
    }
  }
};
