import express from "express";
import cors from "cors";
import { createServer } from "http";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { SOURCES } from "./sources.js";
import {
  warmCache,
  startAutoRefresh,
  refreshSource,
  getCached,
  onUpdate,
  getCacheStatus,
} from "./cacheManager.js";
import { initWebSocket, getClientCount } from "./wsManager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3001;
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutos

app.use(cors());
app.use(express.json());

// ─── ROTAS HTTP ───────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({ name: "pauta-backend", status: "ok" });
});

app.get("/feed", async (req, res) => {
  const requestedIds = req.query.sources
    ? req.query.sources.split(",").map((s) => s.trim())
    : SOURCES.map((s) => s.id);

  const sources = SOURCES.filter((s) => requestedIds.includes(s.id));
  if (!sources.length) {
    return res.status(400).json({
      error: "Nenhuma fonte válida.",
      validSources: SOURCES.map((s) => s.id),
    });
  }

  const stale = sources.filter((s) => !getCached(s.id));
  if (stale.length)
    await Promise.allSettled(stale.map((s) => refreshSource(s.id)));

  const feed = sources.map(
    (src) =>
      getCached(src.id) || {
        source: src.id,
        name: src.name,
        url: src.url,
        articles: [],
        error: "Sem dados ainda.",
      },
  );

  res.json({ feed, fetchedAt: new Date().toISOString() });
});

app.get("/sources", (req, res) => {
  res.json(SOURCES.map(({ id, name, url }) => ({ id, name, url })));
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    wsClients: getClientCount(),
    sources: getCacheStatus(),
  });
});

// ─── START ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`Pauta backend em http://localhost:${PORT}`);
  initWebSocket(httpServer);
  startAutoRefresh(); // inicia os timers individuais por fonte
  warmCache(); // aquece em paralelo
});
