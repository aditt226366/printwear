import { prisma } from "../src/config/prisma.js";
import { leadService } from "../src/services/lead.service.js";

async function main() {
  const result = await leadService.refreshAllLeadScores();
  console.log(`Recalculated ${result.refreshed} leads using message-count-only temperature rules.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
