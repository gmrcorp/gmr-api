import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { algoliasearch } from 'algoliasearch';
import fetch from 'node-fetch';
import { createRequire } from "module";


const require = createRequire(import.meta.url);
const pdfModule = require("pdf-parse");
const pdf = pdfModule.default || pdfModule;
import mammoth from "mammoth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function limitText(text, maxBytes = 8000) {
  if (!text) return "";

  let result = text;
  while (Buffer.byteLength(result, "utf8") > maxBytes) {
    result = result.slice(0, Math.floor(result.length * 0.9));
  }

  return result;
}

dotenv.config({
  path: path.resolve(__dirname, "../../.env")
});
/* ===============================
   Algolia config (WITH ENV VARS)
================================ */
const ALGOLIA_APP_ID = process.env.ALGOLIA_APP_ID;
const ALGOLIA_WRITE_KEY = process.env.ALGOLIA_WRITE_KEY;
const ALGOLIA_INDEX = process.env.ALGOLIA_INDEX;
const SITE_URL = process.env.SITE_URL;

if (!ALGOLIA_APP_ID || !ALGOLIA_WRITE_KEY) {
  throw new Error("Missing Algolia credentials in environment variables");
}

const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_WRITE_KEY);
const index = client.initIndex(ALGOLIA_INDEX);

const API_SOURCES = [
  {
    name: "news",
    url: "https://3842504-gmrapi-stage.adobeio-static.net/api/v1/web/gmr/news-update?category=global&limit=50",
    extract: (json) =>
      json?.data?.data?.newsList?.items || [],
    map: (item) => ({
      objectID: `news-${item.id || item.title}`,
      title: item.title || "",
      description: item.description?.plaintext || "",
      content: limitText(item.description?.plaintext || ""),
      url: item.ctaLink || "",
      image: item.cardImage?._publishUrl || "",
      category: item.category || "",
      publishedAt:
        item.publishDate?.iso ||
        item.publishDate?.value ||
        "",
      type: "news"
    })
  },
  {
    name: "success",
    url: "https://3842504-gmrapi-stage.adobeio-static.net/api/v1/web/gmr/success-story?category=global",
    extract: (json) =>
      json?.data?.data?.successStoryList?.items || [],
    map: (item) => ({
      objectID: `success-${item.id || item.title}`,
      title: item.title || "",
      description: item.description?.plaintext || "",
      content: item.description?.plaintext || "",
      url: item.ctaLink || "",
      image: item.cardImage?._publishUrl || "",
      category: item.category || "",
      type: "success"
    })
  }
];

/* ===============================
   Extract document text (PDF/DOCX)
================================ */
async function extractDocumentText(fileUrl) {
  try {
    console.log("📄 Extracting:", fileUrl);

    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());

    if (fileUrl.toLowerCase().endsWith(".pdf")) {
      const data = await pdf(buffer);
      return (data.text || "")
        .replace(/\s+/g, " ")
        .trim();
    }

    if (fileUrl.toLowerCase().endsWith(".docx") || fileUrl.includes("export?format=docx")) {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || "";
    }

    console.warn("⚠️ Unsupported file type:", fileUrl);
    return "";

  } catch (err) {
    console.error("❌ Document extraction failed:", fileUrl, err.message);
    return "";
  }
}

/* ===============================
   Extract document links from HTML
================================ */
function extractDocumentLinks(html, pageUrl) {
  const links = new Set();
  const matches = html.match(/https?:\/\/[^"'\s>]+/gi) || [];

  for (let url of matches) {
    const lower = url.toLowerCase();

    if (
      lower.includes(".pdf") ||
      lower.includes(".docx") ||
      lower.includes("docs.google.com/document")
    ) {
      try {
        if (!url.startsWith("http")) {
          url = new URL(url, pageUrl).href;
        }

        // Convert google doc to downloadable docx
        if (url.includes("docs.google.com/document")) {
          const idMatch = url.match(/\/d\/([^/]+)/);
          if (idMatch) {
            url = `https://docs.google.com/document/d/${idMatch[1]}/export?format=docx`;
          }
        }

        links.add(url);
      } catch (err) {
        console.warn("⚠️ Invalid URL found:", url);
      }
    }
  }

  return [...links];
}

/* ===============================
   Fetch pages (from EDS index)
================================ */
async function fetchPages() {
  try {
    const res = await fetch(`${SITE_URL}/query-index.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const json = await res.json();

    return json.data
      .filter(item => {
        if (!item.path) return false;

        if (
          item.path.includes('/nav') ||
          item.path.includes('/footer') ||
          item.path.startsWith('/content/')
        ) {
          return false;
        }

        return true;
      })
      .map(item => {
        let normalizedPath = item.path || "/";
        if(item.path === "/en") {
          normalizedPath = "/en/";
        }else{
          normalizedPath = item.path.startsWith("/en/")
          ? item.path
          : `/en${item.path}`;
        }
        
        return {
          path: normalizedPath,
          url: `${SITE_URL}${normalizedPath}`,
          title: item.title || '',
          description: item.description || '',
          tags: item.tags || ''
        };
      });
  } catch (err) {
    console.error("❌ Failed to fetch pages:", err.message);
    return [];
  }
}

/* ===============================
   Fetch external APIs
================================ */
async function fetchExternalApis() {
  const records = [];

  for (const source of API_SOURCES) {
    try {
      console.log(`🌐 Fetching ${source.name} API`);

      const res = await fetch(source.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      const items = source.extract(json);

      if (!items.length) {
        console.warn(`⚠️ No items from ${source.name}`);
        continue;
      }

      const normalized = items.map(source.map);
      records.push(...normalized);

      console.log(`✅ ${source.name}: ${normalized.length} records`);

    } catch (err) {
      console.error(`❌ API failed: ${source.name}`, err.message);
    }
  }

  return records;
}

/* ===============================
   Extract metadata from HTML
================================ */
function extractMeta(html, name) {
  const regex = new RegExp(
    `<meta[^>]+(name|property)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  return html.match(regex)?.[2] || '';
}

/* ===============================
   Build search record for page
================================ */
async function buildRecord(page) {
  try {
    const res = await fetch(page.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const html = await res.text();
    const documentLinks = extractDocumentLinks(html, page.url);

    const segments = page.path.split("/").filter(Boolean);
    const lang = segments[0] || "en";

    const title =
      html.match(/<title>(.*?)<\/title>/i)?.[1] ||
      page.title ||
      '';

    const metaTitle =
      extractMeta(html, 'og:title') ||
      extractMeta(html, 'title') ||
      title;

    const metaDescription =
      extractMeta(html, 'description') ||
      page.description ||
      '';

    const rawContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const content = limitText(rawContent);

    // Process documents in PARALLEL (much faster)
    let documentRecords = [];
    
    if (documentLinks.length) {
      console.log(`📎 Found ${documentLinks.length} document(s) on ${page.path}`);
      
      documentRecords = await Promise.all(
        documentLinks.map(async (docUrl) => {
          try {
            const text = await extractDocumentText(docUrl);
            if (!text) return null;
            
            // const fileName = docUrl.split("/").pop();
            const cleanText = text.replace(/\s+/g, " ").trim();
            const safeId = docUrl.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 100);
            const fallbackTitle = cleanText.split(" ").slice(0, 5).join(" ");
            const finalTitle = page.title?.trim() || fallbackTitle || "Document";
            return {
              objectID: `${page.path}${safeId}`,
              title: `Document - ${finalTitle}`,
              content: limitText(text),
              type: "document",
              sourcePage: page.path,
              path: page.path,
              url: page.url
            };
          } catch (err) {
            console.warn(`⚠️ Skipped document: ${docUrl}`);
            return null;
          }
        })
      ).then(results => results.filter(Boolean));
    }

    return {
      pageRecord: {
        objectID: page.path,
        path: page.path,
        url: page.url,
        lang,
        title,
        metaTitle,
        description: page.description,
        metaDescription,
        content,
        tags: page.tags,
        type: "page"
      },
      documentRecords
    };

  } catch (err) {
    console.error("❌ Failed to build record for:", page.url, err.message);
    return {
      pageRecord: null,
      documentRecords: []
    };
  }
}

/* ===============================
   Index all pages and documents
================================ */
async function run() {
  try {
    console.log("🚀 Starting indexing process...\n");

    const pages = await fetchPages();
    
    if (!pages.length) {
      console.warn("⚠️ No pages found to index");
      return;
    }

    console.log(`📑 Processing ${pages.length} pages...\n`);

    const allRecords = [];
    let pageCount = 0;
    let documentCount = 0;

    for (const page of pages) {
      const { pageRecord, documentRecords } = await buildRecord(page);
      
      if (pageRecord) {
        allRecords.push(pageRecord);
        pageCount++;
      }
      
      if (documentRecords.length > 0) {
        allRecords.push(...documentRecords);
        documentCount += documentRecords.length;
      }
    }

    const apiRecords = await fetchExternalApis();

    const finalRecords = [
      ...allRecords,
      ...apiRecords
    ];

    if (!finalRecords.length) {
      console.warn('⚠️ No records to index');
      return;
    }

    console.log(`\n📤 Uploading ${finalRecords.length} records to Algolia...`);
    
    try {
      await index.saveObjects(finalRecords);
      console.log(`\n✅ SUCCESS! Indexed:`);
      console.log(`   📄 Pages: ${pageCount}`);
      console.log(`   📎 Documents: ${documentCount}`);
      console.log(`   📰 API Records: ${apiRecords.length}`);
      console.log(`   📊 Total: ${finalRecords.length}`);
    } catch (err) {
      console.error("❌ Algolia save failed:", err.message);
      throw err;
    }

  } catch (err) {
    console.error("🔥 Indexer crashed:", err.message);
    process.exit(1);
  }
}

run();