import puppeteer from "puppeteer";
import { enqueue } from "./queue.js";

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

function dedup(articles) {
  const seen = new Set();
  return articles.filter((a) => {
    if (!a.url || !a.title || seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
}

// ─── G1 SP ────────────────────────────────────────────────────────────────────
async function _scrapeG1SP(limit = 20) {
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
              source: "g1",
              title,
              url,
              publishedAt: item.publication || item.lastPublication || null,
            });
          }
          if (results.length > 0) return results;
        }
      } catch (e) {}

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
  }
}

// ─── FOLHA ────────────────────────────────────────────────────────────────────
async function _scrapeFolhaSP(limit = 20) {
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
            results.push({ source: "folha", title, url, publishedAt });
          } catch (e) {}
        });
      return results;
    }, limit);
  } finally {
    await page.close();
  }
}

// ─── ESTADÃO ──────────────────────────────────────────────────────────────────
async function _scrapeEstadaoSP(limit = 20) {
  const browser = await getBrowser();
  const page = await getPage(browser);
  try {
    await page.goto("https://www.estadao.com.br/sao-paulo/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page
      .waitForFunction(
        () => window.Fusion?.contentCache?.["story-feed-query"],
        { timeout: 25000 },
      )
      .catch(() => {});

    return await page.evaluate((limit) => {
      const results = [];
      const seen = new Set();

      // ESTRATÉGIA 1: Fusion.contentCache
      try {
        const feedCache = window.Fusion?.contentCache?.["story-feed-query"];
        if (feedCache) {
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
              results.push({
                source: "estadao",
                title,
                url,
                publishedAt:
                  item.display_date || item.first_publish_date || null,
              });
            }
            if (results.length >= limit) break;
          }
          if (results.length > 0) return results;
        }
      } catch (e) {}

      // ESTRATÉGIA 2: fallback DOM
      const cards = document.querySelectorAll("article, [data-type='story']");
      for (const card of cards) {
        if (results.length >= limit) break;
        const a = card.querySelector("a[href*='estadao.com.br']");
        const titleEl = card.querySelector("h2, h3");
        if (!a || !titleEl) continue;
        const title = titleEl.textContent?.replace(/\s+/g, " ").trim();
        if (!title || title.length < 10) continue;
        if (seen.has(a.href)) continue;
        seen.add(a.href);
        results.push({
          source: "estadao",
          title,
          url: a.href,
          publishedAt: null,
        });
      }
      return results;
    }, limit);
  } finally {
    await page.close();
  }
}

// ─── O GLOBO ──────────────────────────────────────────────────────────────────
async function _scrapeOGlobo(limit = 20) {
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
              source: "oglobo",
              title,
              url,
              publishedAt: item.publication || item.lastPublication || null,
            });
          }
          if (results.length > 0) return results;
        }
      } catch (e) {}

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
  }
}

// ─── DISPATCHER ───────────────────────────────────────────────────────────────
// Todas as funções de scrape passam pela fila global — nunca rodam em paralelo
export async function scrapeSource(source, limit = 20) {
  const scrapers = {
    g1: () => _scrapeG1SP(limit),
    folha: () => _scrapeFolhaSP(limit),
    estadao: () => _scrapeEstadaoSP(limit),
    oglobo: () => _scrapeOGlobo(limit),
  };

  const fn = scrapers[source.id];
  if (!fn) throw new Error(`Scraper não implementado para: ${source.id}`);

  // Enfileira — só executa quando tiver slot disponível
  const articles = await enqueue(fn);
  const deduped = dedup(articles);

  return {
    source: source.id,
    name: source.name,
    url: source.url,
    articles: deduped.map((a) => ({ ...a, id: a.url })),
    count: deduped.length,
  };
}

process.on("exit", () => browserInstance?.close());
process.on("SIGINT", () => {
  browserInstance?.close();
  process.exit();
});
