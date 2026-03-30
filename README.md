# Pauta — Backend

Servidor Node.js que agrega feeds de portais de notícias e entrega como JSON limpo. Sem banco de dados — cada requisição busca os feeds na hora.

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
