# Pauta — Backend

Servidor Node.js que agrega feeds RSS de portais de notícias e entrega como JSON limpo. Sem banco de dados — cada requisição busca os feeds na hora.

## Requisitos

- Node.js 18+

## Instalação e uso

```bash
npm install
```

Coloque o arquivo `painel-noticias.html` na mesma pasta do `server.js`, depois:

```bash
npm start
```

Abra **http://localhost:3001** no navegador. O backend serve o painel diretamente — não abra o HTML como arquivo local, senão as chamadas à API falham por bloqueio de segurança do navegador.

Para desenvolvimento com reload automático:
```bash
npm run dev
```

---

## Endpoints

### `GET /feed`

Retorna artigos de todas as fontes (ou das fontes solicitadas) em paralelo.

**Parâmetros opcionais:**
| Param | Exemplo | Descrição |
|-------|---------|-----------|
| `sources` | `g1,folha` | Filtra por ID de fonte. Sem esse param, retorna todas. |
| `limit` | `10` | Limite de artigos por fonte (máx 50, padrão 20). |

**Exemplo:**
```
GET /feed?sources=g1,folha&limit=10
```

**Resposta:**
```json
{
  "feed": [
    {
      "source": "g1",
      "name": "G1 São Paulo",
      "url": "g1.globo.com/sp",
      "count": 10,
      "articles": [
        {
          "id": "https://g1.globo.com/...",
          "source": "g1",
          "title": "Prefeitura anuncia obras na Paulista",
          "url": "https://g1.globo.com/sp/...",
          "publishedAt": "2026-02-19T10:30:00.000Z"
        }
      ]
    }
  ],
  "fetchedAt": "2026-02-19T12:00:00.000Z"
}
```

---

### `GET /sources`

Lista todas as fontes disponíveis.

```json
[
  { "id": "g1", "name": "G1 São Paulo", "url": "g1.globo.com/sp" },
  { "id": "uol", "name": "UOL Notícias", "url": "noticias.uol.com.br" },
  ...
]
```

---

### `GET /health`

Health check para monitoramento.

```json
{ "status": "ok", "uptime": 42.3 }
```

---

## Adicionando fontes

Edite o arquivo `sources.js`. Cada fonte precisa de um RSS público válido:

```js
{
  id: 'agencia-brasil',
  name: 'Agência Brasil',
  url: 'agenciabrasil.ebc.com.br',
  rssUrl: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml',
}
```

---

## Deploy no Railway

1. Crie uma conta em [railway.app](https://railway.app)
2. Crie um novo projeto → "Deploy from GitHub repo"
3. Suba esse repositório no GitHub e conecte
4. O Railway detecta Node automaticamente e usa `npm start`
5. Pronto — você recebe uma URL pública como `https://pauta-backend.up.railway.app`

## Deploy no Render

1. Crie conta em [render.com](https://render.com)
2. New → Web Service → conecte o repositório
3. Build command: `npm install`
4. Start command: `node server.js`
5. Plano free funciona perfeitamente para esse uso

---

## Integração com o frontend

No `painel-noticias.html`, troque a lógica de RSS direto por:

```js
const API = 'http://localhost:3001'; // ou sua URL do Railway/Render

async function fetchSource(source) {
  const res = await fetch(`${API}/feed?sources=${source.id}&limit=20`);
  const data = await res.json();
  return data.feed[0].articles;
}
```
