import { googleSheetsService, validateGoogleSheetsConfig } from "../services/googleSheets.service.js";
import { leadService } from "../services/lead.service.js";
import { logger } from "../utils/logger.js";

export async function importLeadsJob(companyId?: string) {
  logger.info("Validating Google Sheets environment for lead import");
  validateGoogleSheetsConfig();
  logger.info("Google Sheets environment validated for lead import");

  const sheetLeads = await googleSheetsService.getNewLeads();
  let imported = 0;
  let duplicates = 0;
  let invalid = 0;

  if (sheetLeads.length === 0) {
    logger.info("Lead import found no rows with status=new");
  }

  for (const sheetLead of sheetLeads) {
    logger.info({ rowNumber: sheetLead.rowNumber }, "Importing lead row into database");
    const result = await leadService.importLead({
      name: sheetLead.name,
      phone: sheetLead.phone,
      rowNumber: sheetLead.rowNumber
    }, companyId);

    if (result.imported) {
      imported += 1;
      logger.info({ rowNumber: sheetLead.rowNumber }, "Lead row inserted into database");
    } else if (result.reason === "duplicate") {
      duplicates += 1;
      logger.info({ rowNumber: sheetLead.rowNumber }, "Lead row skipped as duplicate");
    } else {
      invalid += 1;
      logger.info({ rowNumber: sheetLead.rowNumber, reason: result.reason }, "Lead row skipped as invalid");
    }
  }

  logger.info({ imported, duplicates, invalid, scanned: sheetLeads.length }, "Lead import finished");

  return {
    success: true,
    scanned: sheetLeads.length,
    imported,
    importedCount: imported,
    duplicates,
    invalid
  };
}
