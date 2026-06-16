import { KnowledgeSourceType, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";

const defaultEntries = [
  {
    title: "Printwear Company Product Knowledge",
    category: "printwear_products",
    sourceType: KnowledgeSourceType.SEED,
    sourceName: "Printwear manual seed",
    sourceKey: "seed:printwear-company-product-knowledge",
    content: `Printwear is a company that provides customizable apparel and printwear products.

Product Categories:

1. Round Neck T-Shirts

* Sizes: S to 6XL
* GSM: 180 and 220
* Colors: Blue, White, Red, Navy Blue, Grey, Maroon, Yellow, Royal Blue, Bottle Green

2. Polo/Collar T-Shirts

* GSM: 220
* Colors: Blue, White, Red, Navy Blue, Grey, Maroon, Charcoal Melange, Beige

3. Hoodies

* GSM: 340
* Colors: Black, White, Red, Navy Blue, Grey, Charcoal

4. Oversized T-Shirts

* GSM: 180 and 240
* Colors: White, Red, Navy Blue

5. Kids Wear / Kids Collection

* Sizes: 0-1 years to 16-17 years
* GSM: 180
* Colors: Black, White, Red, Yellow, Sky Blue, Bottle Green

Claude AI behavior:

Claude should act as Printwear's WhatsApp sales assistant.

Rules:

* Use only the knowledge base and website-ingested information.
* Do not invent prices, stock, discounts, delivery timelines, or policies.
* If information is missing, reply: "I will have our team confirm that and get back to you."
* Keep replies short and WhatsApp-friendly.
* Help customers choose the right product.
* Ask follow-up questions to qualify the lead.
* Collect order requirements:

  * Product type
  * Quantity
  * Size
  * Color
  * GSM preference
  * Printing/customization requirement
  * Delivery location
* Never mention Claude, AI, RAG, database, embeddings, or internal system details.`
  }
];

async function defaultCompanyId() {
  const company = await prisma.company.upsert({
    where: { slug: "printwear" },
    update: {},
    create: { name: "Printwear", slug: "printwear" }
  });
  return company.id;
}

export const knowledgeService = {
  async seedDefaults() {
    let created = 0;
    const companyId = await defaultCompanyId();

    for (const entry of defaultEntries) {
      const existing = await prisma.knowledgeBase.findFirst({
        where: {
          companyId,
          OR: [{ sourceKey: entry.sourceKey }, { title: entry.title }]
        }
      });

      if (!existing) {
        await prisma.knowledgeBase.create({ data: { ...entry, companyId } });
        created += 1;
      } else {
        await prisma.knowledgeBase.update({
          where: { id: existing.id },
          data: { ...entry, companyId }
        });
      }
    }

    return { created, totalDefaults: defaultEntries.length };
  },

  async list() {
    return prisma.knowledgeBase.findMany({
      orderBy: [{ category: "asc" }, { title: "asc" }]
    });
  },

  async search(query: string, limit = 3, companyId?: string | null) {
    const trimmed = query.trim();
    const scope = companyId ?? null;

    if (!trimmed) {
      const entries = await prisma.knowledgeBase.findMany({ where: scope ? { companyId: scope } : {}, take: limit });
      return entries.map((entry) => `${entry.title}: ${entry.content}`).join("\n\n");
    }

    const matches = await prisma.$queryRaw<Array<{ title: string; content: string; category: string }>>(
      Prisma.sql`
        SELECT title, content, category
        FROM "KnowledgeBase"
        WHERE (${scope}::text IS NULL OR "companyId" = ${scope})
          AND to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, '') || ' ' || coalesce(category, ''))
          @@ plainto_tsquery('simple', ${trimmed})
        ORDER BY ts_rank(
          to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, '') || ' ' || coalesce(category, '')),
          plainto_tsquery('simple', ${trimmed})
        ) DESC
        LIMIT ${limit}
      `
    );

    const entries =
      matches.length > 0
        ? matches
        : await prisma.knowledgeBase.findMany({
            where: {
              ...(scope ? { companyId: scope } : {}),
              OR: [
                { title: { contains: trimmed, mode: "insensitive" } },
                { content: { contains: trimmed, mode: "insensitive" } },
                { category: { contains: trimmed, mode: "insensitive" } }
              ]
            },
            take: limit
          });

    if (entries.length === 0) {
      const fallback = await prisma.knowledgeBase.findMany({ where: scope ? { companyId: scope } : {}, take: limit });
      return fallback.map((entry) => `${entry.title}: ${entry.content}`).join("\n\n");
    }

    return entries.map((entry) => `${entry.title}: ${entry.content}`).join("\n\n");
  }
};
