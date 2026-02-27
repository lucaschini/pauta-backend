import puppeteer from "puppeteer";

const BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
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
export async function scrapeG1SP(limit = 20) {
  const browser = await getBrowser();
  const page = await getPage(browser);
  try {
    await page.goto("https://g1.globo.com/sp/sao-paulo/ultimas-noticias/", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Espera o bstn expor os dados embutidos
    await page
      .waitForFunction(() => window.bstn?.debugEmbedData, { timeout: 15000 })
      .catch(() => {});

    return await page.evaluate((limit) => {
      const results = [];

      // ESTRATÉGIA 1: JSON embutido via bstn (tem datas ISO perfeitas)
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
              id: url,
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
          id: a.href,
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
// A Folha embute um <script type="application/json" data-sharebar-json> em cada card
// com { url, title, cover_date } — título e data limpos, sem depender de seletores CSS.
// São 100 itens por página, muito mais que o necessário.

export async function scrapeFolhaSP(limit = 20) {
  const browser = await getBrowser();
  const page = await getPage(browser);
  try {
    await page.goto("https://www1.folha.uol.com.br/ultimas-noticias/", {
      waitUntil: "networkidle2",
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
            const publishedAt = data.cover_date || null; // "2026-02-19 11:06"

            if (!url || !title || title.length < 10) return;
            if (!url.match(/\/20\d{2}\/\d{2}\/[^/]+\.shtml/)) return;
            if (seen.has(url)) return;
            seen.add(url);

            results.push({ id: url, source: "folha", title, url, publishedAt });
          } catch (e) {
            // JSON inválido, ignora
          }
        });
      return results;
    }, limit);
  } finally {
    await page.close();
  }
}

// ─── ESTADÃO ──────────────────────────────────────────────────────────────────
// Lê Fusion.contentCache['story-feed-query'] embutido no <script> da página.
// Cada entrada tem: headlines.basic (título), canonical_url, display_date (ISO).

export async function scrapeEstadaoSP(limit = 20) {
  const browser = await getBrowser();
  const page = await getPage(browser);
  try {
    await page.goto("https://www.estadao.com.br/sao-paulo/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction(
      () => window.Fusion?.contentCache?.["story-feed-query"],
      { timeout: 15000 },
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
              id: url,
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
  }
}

// ─── O GLOBO ──────────────────────────────────────────────────────────────────
export async function scrapeOGlobo(limit = 20) {
  const browser = await getBrowser();
  const page = await getPage(browser);
  try {
    await page.goto("https://oglobo.globo.com/ultimas-noticias/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Mesma estratégia: espera o bstn
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
              id: url,
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
          id: a.href,
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
  const deduped = dedup(articles);
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
