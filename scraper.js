import puppeteer from "puppeteer";
import { createHash } from "crypto";

const BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-sync",
  "--disable-translate",
  "--hide-scrollbars",
  "--metrics-recording-only",
  "--mute-audio",
  "--no-first-run",
  "--safebrowsing-disable-auto-update",
  "--js-flags=--max-old-space-size=256",
];

let browserInstance = null;
// Semáforo: limita scrapes simultâneos para evitar múltiplos Chromes em paralelo
let activeScrapes = 0;
const MAX_CONCURRENT = 2;

async function acquireSlot() {
  while (activeScrapes >= MAX_CONCURRENT) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  activeScrapes++;
}

function releaseSlot() {
  activeScrapes--;
}

async function getBrowser() {
  if (!browserInstance || !browserInstance.connected) {
    browserInstance = await puppeteer.launch({
      headless: "new",
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: BROWSER_ARGS,
    });
  }
  return browserInstance;
}

async function getPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  );
  await page.setViewport({ width: 1280, height: 900 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (["image", "font", "stylesheet", "media"].includes(req.resourceType())) {
      req.abort();
    } else {
      req.continue();
    }
  });
  return page;
}

// ─── Hash de título para deduplicação ────────────────────────────────────────
function titleHash(title) {
  const normalized = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-z0-9\s]/g, "") // remove pontuação
    .replace(/\s+/g, " ") // colapsa espaços
    .trim();
  return createHash("sha1").update(normalized).digest("hex").slice(0, 12);
}

function dedup(articles) {
  const seen = new Set();
  return articles.filter((a) => {
    if (!a.title || seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}

// ─── G1 SP ────────────────────────────────────────────────────────────────────
export async function scrapeG1SP(limit = 20) {
  await acquireSlot();
  const browser = await getBrowser();
  const page = await getPage(browser);
  try {
    await page.goto("https://g1.globo.com/sp/sao-paulo/ultimas-noticias/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page
      .waitForFunction(() => window.bstn?.debugEmbedData, { timeout: 15000 })
      .catch(() => {});

    return await page.evaluate((limit) => {
      const results = [];

      // ESTRATÉGIA 1: JSON embutido via bstn
      try {
        const embedData = window.bstn?.debugEmbedData?.();
        if (embedData?.items?.length) {
          for (const item of embedData.items) {
            if (results.length >= limit) break;
            const title = item.content?.title?.replace(/\s+/g, " ").trim();
            const url = item.content?.url;
            if (!title || title.length < 10 || !url?.includes(".ghtml"))
              continue;
            results.push({
              id: null, // preenchido fora do evaluate
              source: "g1",
              title,
              url,
              publishedAt: item.publication || item.lastPublication || null,
            });
          }
          if (results.length > 0) return results;
        }
      } catch (e) {}

      // ESTRATÉGIA 2: fallback DOM
      const cards = document.querySelectorAll("div.feed-post");
      for (const card of cards) {
        if (results.length >= limit) break;
        const a = card.querySelector("a.feed-post-link");
        if (!a || !a.href.includes(".ghtml")) continue;
        const title = (a.querySelector("p")?.innerText || a.innerText)
          .replace(/\s+/g, " ")
          .trim();
        if (title.length < 10) continue;
        const dateEl = card.querySelector(".feed-post-datetime");
        results.push({
          id: null,
          source: "g1",
          title,
          url: a.href,
          publishedAt: dateEl?.textContent.trim() || null,
        });
      }
      return results;
    }, limit);
  } finally {
    await page.close();
    releaseSlot();
  }
}

// ─── FOLHA ────────────────────────────────────────────────────────────────────
export async function scrapeFolhaSP(limit = 20) {
  await acquireSlot();
  const browser = await getBrowser();
  const page = await getPage(browser);
  try {
    await page.goto("https://www1.folha.uol.com.br/ultimas-noticias/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForSelector("script[data-sharebar-json]", {
      timeout: 15000,
    });

    return await page.evaluate((limit) => {
      const results = [];
      const seen = new Set();

      document
        .querySelectorAll("script[data-sharebar-json]")
        .forEach((script) => {
          if (results.length >= limit) return;
          try {
            const data = JSON.parse(script.textContent.trim());
            const url = data.url;
            const title = data.title?.replace(/\s+/g, " ").trim();
            const publishedAt = data.cover_date || null;

            if (!url || !title || title.length < 10) return;
            if (!url.match(/\/20\d{2}\/\d{2}\/[^/]+\.shtml/)) return;
            if (seen.has(url)) return;
            seen.add(url);

            results.push({
              id: null,
              source: "folha",
              title,
              url,
              publishedAt,
            });
          } catch (e) {}
        });
      return results;
    }, limit);
  } finally {
    await page.close();
    releaseSlot();
  }
}

// ─── ESTADÃO ──────────────────────────────────────────────────────────────────
export async function scrapeEstadaoSP(limit = 20) {
  await acquireSlot();
  const browser = await getBrowser();
  const page = await getPage(browser);
  try {
    await page.goto("https://www.estadao.com.br/sao-paulo/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction(
      () => window.Fusion?.contentCache?.["story-feed-query"],
      { timeout: 25000 },
    );

    return await page.evaluate((limit) => {
      const results = [];
      const seen = new Set();
      try {
        const feedCache = window.Fusion.contentCache["story-feed-query"];
        for (const cacheVal of Object.values(feedCache)) {
          const elements = cacheVal?.data?.content_elements;
          if (!Array.isArray(elements)) continue;
          for (const item of elements) {
            if (results.length >= limit) break;
            if (item.type !== "story") continue;
            const title = item.headlines?.basic?.replace(/\s+/g, " ").trim();
            if (!title || title.length < 10) continue;
            const url =
              "https://www.estadao.com.br" + (item.canonical_url || "");
            if (seen.has(url)) continue;
            seen.add(url);
            const publishedAt =
              item.display_date || item.first_publish_date || null;
            results.push({
              id: null,
              source: "estadao",
              title,
              url,
              publishedAt,
            });
          }
          if (results.length >= limit) break;
        }
      } catch (e) {}
      return results;
    }, limit);
  } finally {
    await page.close();
    releaseSlot();
  }
}

// ─── O GLOBO ──────────────────────────────────────────────────────────────────
export async function scrapeOGlobo(limit = 20) {
  await acquireSlot();
  const browser = await getBrowser();
  const page = await getPage(browser);
  try {
    await page.goto("https://oglobo.globo.com/ultimas-noticias/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page
      .waitForFunction(() => window.bstn?.debugEmbedData, { timeout: 15000 })
      .catch(() => {});

    return await page.evaluate((limit) => {
      const results = [];

      // ESTRATÉGIA 1: JSON embutido
      try {
        const embedData = window.bstn?.debugEmbedData?.();
        if (embedData?.items?.length) {
          for (const item of embedData.items) {
            if (results.length >= limit) break;
            const title = item.content?.title?.replace(/\s+/g, " ").trim();
            const url = item.content?.url;
            if (!title || title.length < 10 || !url?.includes(".ghtml"))
              continue;
            results.push({
              id: null,
              source: "oglobo",
              title,
              url,
              publishedAt: item.publication || item.lastPublication || null,
            });
          }
          if (results.length > 0) return results;
        }
      } catch (e) {}

      // ESTRATÉGIA 2: fallback DOM
      const cards = document.querySelectorAll("div.feed-post");
      for (const card of cards) {
        if (results.length >= limit) break;
        const a = card.querySelector("a.feed-post-link");
        if (!a || !a.href.includes(".ghtml")) continue;
        const title = (a.querySelector("p")?.innerText || a.innerText)
          .replace(/\s+/g, " ")
          .trim();
        if (title.length < 10) continue;
        const dateEl = card.querySelector("span.feed-post-datetime");
        results.push({
          id: null,
          source: "oglobo",
          title,
          url: a.href,
          publishedAt: dateEl?.textContent.trim() || null,
        });
      }
      return results;
    }, limit);
  } finally {
    await page.close();
    releaseSlot();
  }
}

// ─── DISPATCHER ───────────────────────────────────────────────────────────────
export async function scrapeSource(source, limit = 20) {
  let articles;
  switch (source.id) {
    case "g1":
      articles = await scrapeG1SP(limit);
      break;
    case "folha":
      articles = await scrapeFolhaSP(limit);
      break;
    case "estadao":
      articles = await scrapeEstadaoSP(limit);
      break;
    case "oglobo":
      articles = await scrapeOGlobo(limit);
      break;
    default:
      throw new Error(`Scraper não implementado para: ${source.id}`);
  }

  // Aplica hash de título aqui, fora do evaluate (sem acesso ao crypto no browser)
  const withHash = articles.map((a) => ({ ...a, id: titleHash(a.title) }));
  const deduped = dedup(withHash);

  return {
    source: source.id,
    name: source.name,
    url: source.url,
    articles: deduped,
    count: deduped.length,
  };
}

process.on("exit", () => browserInstance?.close());
process.on("SIGINT", () => {
  browserInstance?.close();
  process.exit();
});
