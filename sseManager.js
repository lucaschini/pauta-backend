import { getAllCached, onUpdate } from "./cacheManager.js";

// Set de responses SSE ativas
const clients = new Set();

export function initSSE(app) {
  app.get("/events", (req, res) => {
    // Headers obrigatórios para SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Registra o cliente
    clients.add(res);
    console.log(`[sse] cliente conectado — total: ${clients.size}`);

    // Envia snapshot do cache atual imediatamente
    const snapshot = getAllCached();
    for (const [sourceId, data] of Object.entries(snapshot)) {
      sendEvent(res, { type: "update", source: sourceId, data });
    }

    // Remove cliente ao desconectar
    req.on("close", () => {
      clients.delete(res);
      console.log(`[sse] cliente desconectado — total: ${clients.size}`);
    });
  });

  // Escuta atualizações do cacheManager e faz broadcast
  onUpdate((payload) => broadcast(payload));

  console.log("[sse] SSE endpoint em /events");
}

function sendEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function broadcast(payload) {
  clients.forEach((res) => sendEvent(res, payload));
}

export function getClientCount() {
  return clients.size;
}
