import { WebSocketServer } from "ws";
import { getAllCached, onUpdate } from "./cacheManager.js";

let wss = null;

export function initWebSocket(httpServer) {
  wss = new WebSocketServer({ server: httpServer });

  // Escuta atualizações do cacheManager e faz broadcast automático
  onUpdate((payload) => broadcast(payload));

  wss.on("connection", (ws) => {
    console.log("[ws] cliente conectado");

    // Envia snapshot do cache atual imediatamente ao conectar
    const snapshot = getAllCached();
    for (const [sourceId, data] of Object.entries(snapshot)) {
      ws.send(JSON.stringify({ type: "update", source: sourceId, data }));
    }

    ws.on("close", () => console.log("[ws] cliente desconectado"));
    ws.on("error", (err) => console.error("[ws] erro:", err.message));
  });

  console.log("[ws] WebSocket server iniciado");
  return wss;
}

export function broadcast(payload) {
  if (!wss) return;
  const msg = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

export function getClientCount() {
  return wss?.clients.size ?? 0;
}
