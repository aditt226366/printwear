import { googleSheetsService } from "../services/googleSheets.service.js";
import { leadService } from "../services/lead.service.js";
import { logger } from "../utils/logger.js";

export async function importLeadsJob() {
  const sheetLeads = await googleSheetsService.getNewLeads();
  let imported = 0;
  let duplicates = 0;
  let invalid = 0;

  for (const sheetLead of sheetLeads) {
    const result = await leadService.importLead({
      name: sheetLead.name,
      phone: sheetLead.phone,
      rowNumber: sheetLead.rowNumber
    });

    if (result.imported) {
      imported += 1;
    } else if (result.reason === "duplicate") {
      duplicates += 1;
    } else {
      invalid += 1;
    }
  }

  logger.info({ imported, duplicates, invalid, scanned: sheetLeads.length }, "Lead import finished");

  return {
    scanned: sheetLeads.length,
    imported,
    duplicates,
    invalid
  };
}
