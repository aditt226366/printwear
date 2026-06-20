import { google } from "googleapis";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { normalizePhoneNumber } from "../utils/phone.js";
import { apiUsageService } from "./apiUsage.service.js";
import { companyIntegrationService, type GoogleSheetsCredentials, type GoogleSheetsIntegrationInput } from "./companyIntegration.service.js";

export type SheetLead = {
  name: string;
  phone: string;
  rowNumber: number;
};

export type GoogleSheetsStatus = {
  connected: boolean;
  serviceAccountEmail: string | null;
  sheetId: string | null;
  readable: boolean;
  rowCount: number;
  headers: string[];
  error: string | null;
  accessTokenProvidedInRequest: boolean;
  savedAccessTokenExists: boolean;
  privateKeyProvidedInRequest: boolean;
  savedPrivateKeyExists: boolean;
  encryptionKeyConfigured: boolean;
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

export async function validateGoogleSheetsConfig(companyId?: string | null, input?: GoogleSheetsIntegrationInput) {
  const config = await companyIntegrationService.googleSheets(companyId, input);
  if (!config.spreadsheetId?.trim()) throw new AppError("GOOGLE_SHEETS_ID wrong", 400);
  if (!config.serviceAccountEmail?.trim()) throw new AppError("GOOGLE_SERVICE_ACCOUNT_EMAIL wrong", 400);
  if (!config.privateKey?.trim()) throw new AppError("GOOGLE_PRIVATE_KEY wrong", 400);
  const key = normalizePrivateKey(config.privateKey);
  if (!key.startsWith("-----BEGIN PRIVATE KEY-----") || !key.endsWith("-----END PRIVATE KEY-----")) {
    throw new AppError("GOOGLE_PRIVATE_KEY wrong", 400);
  }

  return {
    spreadsheetId: config.spreadsheetId,
    serviceAccountEmail: config.serviceAccountEmail,
    privateKey: key
  };
}

async function getAuthClient(companyId?: string | null, input?: GoogleSheetsIntegrationInput) {
  const config = await validateGoogleSheetsConfig(companyId, input);
  logger.info({ serviceAccountEmail: config.serviceAccountEmail }, "Creating Google Sheets auth client");

  return {
    config,
    auth: new google.auth.JWT({
      email: config.serviceAccountEmail,
      key: config.privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    })
  };
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

function googleSheetsErrorMessage(error: unknown, serviceAccountEmail?: string | null) {
  if (error instanceof AppError) return error.message;

  const sheetsError = error as {
    code?: number;
    status?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
    response?: { data?: { error?: { message?: string; errors?: Array<{ reason?: string; message?: string }> } } };
  };
  const status = sheetsError.code ?? sheetsError.status;
  const errors = sheetsError.errors || sheetsError.response?.data?.error?.errors || [];
  const reason = errors.map((item) => item.reason).filter(Boolean).join(" ");
  const providerMessage = sheetsError.response?.data?.error?.message || sheetsError.message || "";

  if (/accessNotConfigured|serviceDisabled|SERVICE_DISABLED|API has not been used|disabled/i.test(`${reason} ${providerMessage}`)) {
    return "Google Sheets API disabled. Enable the Google Sheets API for this project.";
  }

  if (status === 403) {
    return "GOOGLE_SERVICE_ACCOUNT_EMAIL wrong or sheet not shared with service account";
  }

  if (status === 404) {
    return "GOOGLE_SHEETS_ID wrong";
  }

  if (/private key|PEM|DECODER|unsupported|invalid key/i.test(providerMessage)) {
    return "GOOGLE_PRIVATE_KEY wrong";
  }

  if (/email|issuer|invalid_grant|unauthorized_client/i.test(providerMessage)) return "GOOGLE_SERVICE_ACCOUNT_EMAIL wrong";
  return "GOOGLE_SHEETS_ID wrong";
}

export const googleSheetsService = {
  async status(companyId?: string | null, input?: GoogleSheetsIntegrationInput): Promise<GoogleSheetsStatus> {
    let config: GoogleSheetsCredentials | null = null;
    const secretState = await companyIntegrationService.integrationSecretState("googleSheets", companyId, input);

    try {
      const authClient = await getAuthClient(companyId, input);
      config = authClient.config;
      const sheets = google.sheets({ version: "v4", auth: authClient.auth });
      const spreadsheetId = config.spreadsheetId;
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: env.GOOGLE_SHEETS_RANGE
      });
      const rows = response.data.values ?? [];

      void apiUsageService.log({
        companyId,
        provider: "GOOGLE_SHEETS",
        endpoint: "debug.spreadsheets.values.get",
        method: "GET",
        statusCode: 200,
        success: true,
        metadata: { spreadsheetId, range: env.GOOGLE_SHEETS_RANGE }
      });

      return {
        connected: true,
        serviceAccountEmail: config.serviceAccountEmail,
        sheetId: config.spreadsheetId,
        readable: true,
        rowCount: rows.length,
        headers: (rows[0] ?? []).map((header) => String(header)),
        error: null,
        ...secretState
      };
    } catch (error) {
      const sheetsError = error as { code?: number; status?: number };
      void apiUsageService.log({
        companyId,
        provider: "GOOGLE_SHEETS",
        endpoint: "debug.spreadsheets.values.get",
        method: "GET",
        statusCode: Number(sheetsError.code || sheetsError.status || 500),
        success: false,
        metadata: { spreadsheetId: config?.spreadsheetId ?? null, range: env.GOOGLE_SHEETS_RANGE }
      });

      return {
        connected: false,
        serviceAccountEmail: config?.serviceAccountEmail ?? null,
        sheetId: config?.spreadsheetId ?? null,
        readable: false,
        rowCount: 0,
        headers: [],
        error: googleSheetsErrorMessage(error, config?.serviceAccountEmail ?? null),
        ...secretState
      };
    }
  },

  async getNewLeads(companyId?: string | null): Promise<SheetLead[]> {
    logger.info({ range: env.GOOGLE_SHEETS_RANGE }, "Starting Google Sheets lead read");
    const authClient = await getAuthClient(companyId);
    const sheets = google.sheets({ version: "v4", auth: authClient.auth });
    const spreadsheetId = authClient.config.spreadsheetId;
    let response;

    try {
      logger.info({ spreadsheetId, range: env.GOOGLE_SHEETS_RANGE }, "Reading Google Sheets values");
      response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: env.GOOGLE_SHEETS_RANGE
      });
      void apiUsageService.log({
        companyId,
        provider: "GOOGLE_SHEETS",
        endpoint: "spreadsheets.values.get",
        method: "GET",
        statusCode: 200,
        success: true,
        metadata: { spreadsheetId, range: env.GOOGLE_SHEETS_RANGE }
      });
    } catch (error) {
      const sheetsError = error as { code?: number; status?: number };
      const status = sheetsError.code ?? sheetsError.status;
      void apiUsageService.log({
        companyId,
        provider: "GOOGLE_SHEETS",
        endpoint: "spreadsheets.values.get",
        method: "GET",
        statusCode: Number(status || 500),
        success: false,
        metadata: { spreadsheetId, range: env.GOOGLE_SHEETS_RANGE }
      });
      logger.error({ error, status }, "Google Sheets read failed");

      if (status === 403) {
        const serviceAccountEmail = authClient.config.serviceAccountEmail;
        throw new AppError(
          `Google Sheets permission denied. Share this spreadsheet with ${serviceAccountEmail} and give it Editor access.`,
          400
        );
      }

      if (status === 404) {
        throw new AppError("Google Sheet not found. Check the sheet ID and sharing settings.", 400);
      }

      throw new AppError(
        googleSheetsErrorMessage(error, authClient.config.serviceAccountEmail),
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

  async updateLeadStatus(rowNumber: number, status: string, companyId?: string | null) {
    logger.info({ rowNumber, status }, "Updating Google Sheets lead status");
    const authClient = await getAuthClient(companyId);
    const sheets = google.sheets({ version: "v4", auth: authClient.auth });
    const spreadsheetId = authClient.config.spreadsheetId;
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
      void apiUsageService.log({
        companyId,
        provider: "GOOGLE_SHEETS",
        endpoint: "spreadsheets.values.update",
        method: "PUT",
        statusCode: 200,
        success: true,
        metadata: { spreadsheetId, range: `${sheetName}!${statusColumn}${rowNumber}` }
      });
      logger.info({ rowNumber, status }, "Google Sheets lead status updated");
    } catch (error) {
      const sheetsError = error as { code?: number; status?: number };
      void apiUsageService.log({
        companyId,
        provider: "GOOGLE_SHEETS",
        endpoint: "spreadsheets.values.update",
        method: "PUT",
        statusCode: Number(sheetsError.code || sheetsError.status || 500),
        success: false,
        metadata: { spreadsheetId, range: `${sheetName}!${statusColumn}${rowNumber}` }
      });
      logger.error({ error, rowNumber, status }, "Google Sheets status update failed");
      throw new AppError(
        "Google Sheets update failed",
        500,
        error instanceof Error ? error.message : "Unknown Google Sheets update error"
      );
    }
  }
};
