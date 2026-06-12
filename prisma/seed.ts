import { prisma } from "../src/config/prisma.js";
import { knowledgeService } from "../src/services/knowledge.service.js";
import { leadService } from "../src/services/lead.service.js";
import { logger } from "../src/utils/logger.js";

async function main() {
  const result = await knowledgeService.seedDefaults();
  logger.info(result, "Knowledge base seeded");

  const scoring = await leadService.refreshAllLeadScores();
  logger.info(scoring, "Existing lead temperatures recalculated");
}

main()
  .catch((error) => {
    logger.error({ error }, "Seed failed");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
