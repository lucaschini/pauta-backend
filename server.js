import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { scrapeSource } from './scraper.js';
import { SOURCES } from './sources.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });
const PORT = process.env.PORT || 3001;
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutos

app.use(cors());
app.use(express.json());

// ─── CACHE ────────────────────────────────────────────────────────────────────

const cache = {}; // { [sourceId]: { articles, fetchedAt, ... } }

async function refreshSource(sourceId) {
  const source = SOURCES.find(s => s.id === sourceId);
  if (!source) return;
  try {
    console.log(`[scraper] buscando ${sourceId}...`);
    const result = await scrapeSource(source, 20);
    cache[sourceId] = { ...result, fetchedAt: new Date().toISOString() };
    console.log(`[scraper] ${sourceId} — ${result.count} artigos`);

    // Notifica todos os clientes WebSocket conectados
    broadcast({ type: 'update', source: sourceId, data: cache[sourceId] });
  } catch (err) {
    console.error(`[scraper] erro em ${sourceId}:`, err.message);
    if (cache[sourceId]) cache[sourceId].error = err.message;
  }
}

async function warmCache() {
  console.log('[cache] aquecendo...');
  for (const source of SOURCES) {
    await refreshSource(source.id);
  }
  console.log('[cache] pronto');
}

// Re-scrape automático a cada 2 minutos
setInterval(async () => {
  for (const source of SOURCES) {
    await refreshSource(source.id);
  }
}, CACHE_TTL_MS);

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('[ws] cliente conectado');

  // Envia o cache atual imediatamente ao conectar
  for (const sourceId of Object.keys(cache)) {
    ws.send(JSON.stringify({ type: 'update', source: sourceId, data: cache[sourceId] }));
  }

  ws.on('close', () => console.log('[ws] cliente desconectado'));
});

// ─── ROTAS HTTP ───────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'painel-noticias.html'));
});

app.get('/feed', async (req, res) => {
  const requestedIds = req.query.sources
    ? req.query.sources.split(',').map(s => s.trim())
    : SOURCES.map(s => s.id);

  const sources = SOURCES.filter(s => requestedIds.includes(s.id));
  if (!sources.length) {
    return res.status(400).json({ error: 'Nenhuma fonte válida.', validSources: SOURCES.map(s => s.id) });
  }

  const stale = sources.filter(s => !cache[s.id]);
  if (stale.length) await Promise.allSettled(stale.map(s => refreshSource(s.id)));

  const feed = sources.map(src => cache[src.id] || {
    source: src.id, name: src.name, url: src.url, articles: [], error: 'Sem dados ainda.'
  });

  res.json({ feed, fetchedAt: new Date().toISOString() });
});

app.get('/sources', (req, res) => {
  res.json(SOURCES.map(({ id, name, url }) => ({ id, name, url })));
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    wsClients: wss.clients.size,
    sources: SOURCES.map(s => ({
      id: s.id,
      cached: !!cache[s.id],
      fetchedAt: cache[s.id]?.fetchedAt || null,
      count: cache[s.id]?.count || 0,
    }))
  });
});

// ─── START ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`Pauta backend em http://localhost:${PORT}`);
  warmCache();
});
