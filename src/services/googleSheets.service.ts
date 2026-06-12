import { google } from "googleapis";
import { env, requireEnv } from "../config/env.js";
import { AppError } from "../utils/errors.js";
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

function getAuthClient() {
  const email = requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const key = requireEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");

  return new google.auth.JWT({
    email,
    key,
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
    const sheets = google.sheets({ version: "v4", auth: getAuthClient() });
    const spreadsheetId = requireEnv("GOOGLE_SHEETS_ID");
    let response;

    try {
      response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: env.GOOGLE_SHEETS_RANGE
      });
    } catch (error) {
      const sheetsError = error as { code?: number; status?: number };
      const status = sheetsError.code ?? sheetsError.status;

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

      throw error;
    }

    const rows = response.data.values ?? [];
    if (rows.length < 2) {
      return [];
    }

    const headers = rows[0].map(normalizeHeader);
    const nameIndex = findHeaderIndex(headers, ["name", "fullname", "customername"]);
    const phoneIndex = findHeaderIndex(headers, ["phone", "number", "phonenumber", "mobile", "mobilenumber", "whatsapp", "whatsappnumber"]);
    const statusIndex = findHeaderIndex(headers, ["status", "leadstatus"]);

    if (nameIndex === -1 || phoneIndex === -1 || statusIndex === -1) {
      throw new Error("Google Sheet must contain name, phone/number, and status columns");
    }

    return rows
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
  },

  async updateLeadStatus(rowNumber: number, status: string) {
    const sheets = google.sheets({ version: "v4", auth: getAuthClient() });
    const spreadsheetId = requireEnv("GOOGLE_SHEETS_ID");
    const sheetName = env.GOOGLE_SHEETS_RANGE.split("!")[0] || "Sheet1";
    const statusColumn = env.GOOGLE_SHEETS_STATUS_COLUMN || columnIndexToLetter(2);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!${statusColumn}${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[status]]
      }
    });
  }
};
