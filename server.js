import express from "express";
import cors from "cors";
import { createServer } from "http";

import { SOURCES } from "./sources.js";
import {
  warmCache,
  startAutoRefresh,
  refreshSource,
  getCached,
  getCacheStatus,
  isWithinOperatingHours,
} from "./cacheManager.js";
import { initSSE, getClientCount } from "./sseManager.js";

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3001;

app.use(
  cors({
    origin: [process.env.FRONTEND_URL, "http://localhost:3000"].filter(Boolean),
  }),
);
app.use(express.json());

// ─── ROTAS HTTP ───────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({ name: "pauta-backend", status: "ok" });
});

app.get("/status", (req, res) => {
  const active = isWithinOperatingHours();
  res.json({
    active,
    operatingHours: {
      start: "12:00",
      end: "20:00",
      timezone: "America/Sao_Paulo",
    },
    message: active
      ? "Serviço em operação"
      : "O Pauta funciona das 12h às 20h (horário de Brasília)",
  });
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
    active: isWithinOperatingHours(),
    sseClients: getClientCount(),
    sources: getCacheStatus(),
  });
});

// ─── START ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`Pauta backend em http://localhost:${PORT}`);
  initSSE(app);
  startAutoRefresh();
  warmCache();
});
