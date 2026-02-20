// Fontes com scraping direto nas páginas de SP.
// scraperUrl = página que será raspada (deve ter conteúdo SP-específico)
// Para adicionar uma fonte nova, crie também uma função em scraper.js

export const SOURCES = [
  {
    id: "g1",
    name: "G1 São Paulo",
    url: "g1.globo.com/sp/sao-paulo/ultimas-noticias",
  },
  {
    id: "folha",
    name: "Folha de S.Paulo",
    url: "www1.folha.uol.com.br/ultimas-noticias",
  },
  {
    id: "estadao",
    name: "Estadão SP",
    url: "estadao.com.br/sao-paulo",
  },
  {
    id: "oglobo",
    name: "O Globo",
    url: "https://oglobo.globo.com/ultimas-noticias/",
  },
];
