import { MessageDirection } from "@prisma/client";
import { prisma } from "../src/config/prisma.js";
import { humanActionService } from "../src/services/humanAction.service.js";
import { leadService } from "../src/services/lead.service.js";
import { orderSummaryService } from "../src/services/orderSummary.service.js";

async function main() {
  const leads = await prisma.lead.findMany({
    select: {
      id: true,
      messages: {
        where: { direction: MessageDirection.INBOUND },
        orderBy: { createdAt: "asc" },
        select: { content: true }
      }
    }
  });

  let refreshedScores = 0;
  let analyzedMessages = 0;
  let refreshedOrders = 0;

  for (const lead of leads) {
    await leadService.refreshLeadScore(lead.id);
    refreshedScores += 1;

    for (const message of lead.messages) {
      await humanActionService.analyzeInboundMessage(lead.id, message.content);
      analyzedMessages += 1;
    }

    if (lead.messages.length > 0) {
      await orderSummaryService.refreshFromConversation(lead.id);
      refreshedOrders += 1;
    }
  }

  console.log(`Refreshed ${refreshedScores} lead scores.`);
  console.log(`Analyzed ${analyzedMessages} inbound messages for human attention.`);
  console.log(`Refreshed ${refreshedOrders} order summaries from real conversation history.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
