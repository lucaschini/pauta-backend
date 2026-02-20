import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

// Timeout de 8 segundos por fonte
function fetchWithTimeout(url, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, {
    signal: controller.signal,
    headers: {
      // Alguns portais bloqueiam requests sem User-Agent
      'User-Agent': 'Mozilla/5.0 (compatible; PautaBot/1.0; +https://github.com/pauta)'
    }
  }).finally(() => clearTimeout(timer));
}

// Extrai texto limpo de um campo que pode ser string ou objeto
function getText(field) {
  if (!field) return '';
  if (typeof field === 'string') return field.trim();
  if (typeof field === 'object') {
    return (field['#text'] || field['_'] || '').trim();
  }
  return String(field).trim();
}

// Normaliza um item de RSS para o formato de card
function normalizeItem(item, source) {
  const title = getText(item.title);
  const link = getText(item.link) || getText(item.guid) || '';
  const pubDate = getText(item.pubDate) || getText(item['dc:date']) || null;

  // Ignora itens sem título ou link
  if (!title || !link) return null;

  return {
    id: link || title,
    source: source.id,
    title,
    url: link.startsWith('http') ? link : `https://${source.url}${link}`,
    publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
  };
}

export async function fetchSource(source, limit = 20) {
  const response = await fetchWithTimeout(source.rssUrl);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ao buscar ${source.rssUrl}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml);

  // Suporte a RSS 2.0 e Atom
  const channel = parsed?.rss?.channel || parsed?.feed;
  if (!channel) throw new Error('Formato de feed não reconhecido');

  const rawItems = channel.item || channel.entry || [];
  const itemsArray = Array.isArray(rawItems) ? rawItems : [rawItems];

  const articles = itemsArray
    .map(item => normalizeItem(item, source))
    .filter(Boolean)
    .slice(0, limit);

  return {
    source: source.id,
    name: source.name,
    url: source.url,
    articles,
    count: articles.length,
  };
}
