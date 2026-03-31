// Fila global de scraping — garante no máximo MAX_CONCURRENT scrapers rodando
// simultaneamente em todo o processo, independente de quantas fontes existam.

const MAX_CONCURRENT = 1; // conservador para 512MB de RAM
const queue = [];
let running = 0;

export function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    drain();
  });
}

function drain() {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const { fn, resolve, reject } = queue.shift();
    running++;
    fn()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        running--;
        drain();
      });
  }
}

export function getQueueStatus() {
  return { running, queued: queue.length, maxConcurrent: MAX_CONCURRENT };
}
