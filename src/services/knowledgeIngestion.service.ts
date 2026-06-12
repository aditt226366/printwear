import crypto from "node:crypto";
import path from "node:path";
import { load } from "cheerio";
import mammoth from "mammoth";
import { KnowledgeSourceType } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { logger } from "../utils/logger.js";

type ChunkInput = {
  title: string;
  content: string;
  category: string;
  sourceType: KnowledgeSourceType;
  sourceUrl?: string;
  sourceName?: string;
  sourceKey?: string;
};

type UploadedDocument = {
  originalName: string;
  mimeType: string;
  buffer: Buffer;
};

function cleanText(input: string) {
  return input
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function sourceKeyFor(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function chunkText(text: string, chunkSize = env.KNOWLEDGE_CHUNK_SIZE) {
  const cleaned = cleanText(text);
  if (cleaned.length <= chunkSize) {
    return cleaned ? [cleaned] : [];
  }

  const paragraphs = cleaned.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if ((current + "\n\n" + paragraph).trim().length > chunkSize && current) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current = `${current}\n\n${paragraph}`.trim();
    }
  }

  if (current) {
    chunks.push(current.trim());
  }

  return chunks.flatMap((chunk) => {
    if (chunk.length <= chunkSize) return [chunk];
    const parts: string[] = [];
    for (let index = 0; index < chunk.length; index += chunkSize) {
      parts.push(chunk.slice(index, index + chunkSize).trim());
    }
    return parts.filter(Boolean);
  });
}

async function replaceWithChunks(input: ChunkInput) {
  const sourceKey = input.sourceKey ?? sourceKeyFor(`${input.sourceType}:${input.sourceUrl ?? input.sourceName ?? input.title}`);
  const chunks = chunkText(input.content);

  await prisma.knowledgeBase.deleteMany({ where: { sourceKey } });

  if (chunks.length === 0) {
    return { sourceKey, created: 0 };
  }

  await prisma.knowledgeBase.createMany({
    data: chunks.map((chunk, index) => ({
      title: chunks.length === 1 ? input.title : `${input.title} - Part ${index + 1}`,
      content: chunk,
      category: input.category,
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl,
      sourceName: input.sourceName,
      sourceKey,
      chunkIndex: index
    }))
  });

  return { sourceKey, created: chunks.length };
}

function normalizeUrl(value: string, base?: string) {
  const url = new URL(value, base);
  url.hash = "";
  return url.toString();
}

function isSameSite(url: string, origin: string) {
  return new URL(url).origin === origin;
}

async function fetchHtml(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "PrintwearKnowledgeBot/1.0"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return null;
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function extractPage(html: string, url: string) {
  const $ = load(html);
  $("script, style, noscript, svg, img, iframe, nav, footer, form").remove();

  const title = cleanText($("title").first().text()) || new URL(url).pathname || url;
  const description = cleanText($('meta[name="description"]').attr("content") ?? "");
  const parts: string[] = [];

  if (description) {
    parts.push(description);
  }

  $("h1, h2, h3, h4, h5, h6, p, li, td, th").each((_index, element) => {
    const text = cleanText($(element).text());
    if (text.length > 2) {
      parts.push(text);
    }
  });

  const links = new Set<string>();
  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href");
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
      return;
    }

    try {
      links.add(normalizeUrl(href, url));
    } catch {
      // Ignore invalid links from the source site.
    }
  });

  return {
    title,
    content: cleanText(parts.join("\n")),
    links: [...links]
  };
}

async function extractUploadText(file: UploadedDocument) {
  const extension = path.extname(file.originalName).toLowerCase();

  if (file.mimeType === "text/plain" || extension === ".txt") {
    return file.buffer.toString("utf8");
  }

  if (
    file.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === ".docx"
  ) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }

  if (file.mimeType === "application/pdf" || extension === ".pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: file.buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  throw new Error("Unsupported file type. Upload PDF, DOCX, or TXT.");
}

export const knowledgeIngestionService = {
  async upsertDocument(input: ChunkInput) {
    return replaceWithChunks(input);
  },

  async ingestWebsite(url: string, options?: { titlePrefix?: string; category?: string; maxPages?: number }) {
    const startUrl = normalizeUrl(url);
    const origin = new URL(startUrl).origin;
    const maxPages = options?.maxPages ?? env.KNOWLEDGE_CRAWL_MAX_PAGES;
    const category = options?.category ?? "website";
    const queue = [startUrl];
    const visited = new Set<string>();
    const pages: Array<{ url: string; title: string; content: string }> = [];

    while (queue.length > 0 && visited.size < maxPages) {
      const currentUrl = queue.shift();
      if (!currentUrl || visited.has(currentUrl) || !isSameSite(currentUrl, origin)) {
        continue;
      }

      visited.add(currentUrl);

      try {
        const html = await fetchHtml(currentUrl);
        if (!html) {
          continue;
        }

        const page = extractPage(html, currentUrl);
        if (page.content.length > 120) {
          pages.push({ url: currentUrl, title: page.title, content: page.content });
        }

        for (const link of page.links) {
          if (queue.length + visited.size >= maxPages) break;
          if (isSameSite(link, origin) && !visited.has(link)) {
            queue.push(link);
          }
        }
      } catch (error) {
        logger.warn({ error, url: currentUrl }, "Website page ingestion skipped");
      }
    }

    const sourceKey = sourceKeyFor(`website:${origin}`);
    await prisma.knowledgeBase.deleteMany({ where: { sourceKey } });

    let created = 0;
    for (const page of pages) {
      const chunks = chunkText(page.content);
      await prisma.knowledgeBase.createMany({
        data: chunks.map((chunk, index) => ({
          title: `${options?.titlePrefix ?? "Website"}: ${page.title}${chunks.length > 1 ? ` - Part ${index + 1}` : ""}`,
          content: chunk,
          category,
          sourceType: KnowledgeSourceType.WEBSITE,
          sourceUrl: page.url,
          sourceName: origin,
          sourceKey,
          chunkIndex: created + index
        }))
      });
      created += chunks.length;
    }

    return {
      url: startUrl,
      pagesVisited: visited.size,
      pagesStored: pages.length,
      chunksCreated: created
    };
  },

  async ingestUpload(file: UploadedDocument, metadata: { title?: string; category?: string }) {
    const text = await extractUploadText(file);
    return replaceWithChunks({
      title: metadata.title?.trim() || file.originalName,
      content: text,
      category: metadata.category?.trim() || "uploaded_document",
      sourceType: KnowledgeSourceType.UPLOAD,
      sourceName: file.originalName,
      sourceKey: sourceKeyFor(`upload:${file.originalName}:${file.buffer.length}:${file.buffer.subarray(0, 64).toString("hex")}`)
    });
  }
};
