import { scrapeSource } from "./scraper.js";
import { SOURCES } from "./sources.js";

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutos por fonte

// Horário de operação: 12h–20h horário de Brasília (15h–23h UTC)
const OPERATING_START_UTC = 15;
const OPERATING_END_UTC = 23;

// { [sourceId]: { source, name, url, articles, count, fetchedAt, error } }
const cache = {};

const listeners = [];

export function onUpdate(fn) {
  listeners.push(fn);
}

function notify(sourceId) {
  const payload = { type: "update", source: sourceId, data: cache[sourceId] };
  listeners.forEach((fn) => fn(payload));
}

export function isWithinOperatingHours() {
  const hour = new Date().getUTCHours();
  return hour >= OPERATING_START_UTC && hour < OPERATING_END_UTC;
}

export async function refreshSource(sourceId) {
  const source = SOURCES.find((s) => s.id === sourceId);
  if (!source) {
    console.warn(`[cache] fonte desconhecida: ${sourceId}`);
    return;
  }

  console.log(`[scraper] buscando ${sourceId}...`);
  try {
    const result = await scrapeSource(source, 20);
    cache[sourceId] = {
      ...result,
      fetchedAt: new Date().toISOString(),
      error: null,
    };
    console.log(`[scraper] ${sourceId} — ${result.count} artigos`);
    notify(sourceId);
  } catch (err) {
    console.error(`[scraper] erro em ${sourceId}:`, err.message);
    cache[sourceId] = {
      ...(cache[sourceId] || {
        source: sourceId,
        name: source.name,
        url: source.url,
        articles: [],
        count: 0,
      }),
      error: err.message,
      fetchedAt: cache[sourceId]?.fetchedAt || null,
    };
    notify(sourceId);
  }
}

export async function warmCache() {
  if (!isWithinOperatingHours()) {
    console.log("[cache] fora do horário de operação, warmCache ignorado");
    return;
  }
  console.log("[cache] aquecendo em paralelo...");
  await Promise.allSettled(SOURCES.map((s) => refreshSource(s.id)));
  console.log("[cache] pronto");
}

export function startAutoRefresh() {
  SOURCES.forEach((source, index) => {
    const offset = index * 30 * 1000;
    setTimeout(() => {
      setInterval(() => {
        if (isWithinOperatingHours()) {
          refreshSource(source.id);
        } else {
          console.log(`[cache] fora do horário, pulando ${source.id}`);
        }
      }, CACHE_TTL_MS);
    }, offset);
  });
  console.log(`[cache] auto-refresh a cada ${CACHE_TTL_MS / 1000}s por fonte`);
}

export function getCached(sourceId) {
  return cache[sourceId] || null;
}

export function getAllCached() {
  return { ...cache };
}

export function getCacheStatus() {
  return SOURCES.map((s) => ({
    id: s.id,
    cached: !!cache[s.id],
    fetchedAt: cache[s.id]?.fetchedAt || null,
    count: cache[s.id]?.count || 0,
    error: cache[s.id]?.error || null,
  }));
}
