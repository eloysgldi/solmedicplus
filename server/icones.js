import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

/**
 * ============================================================
 * ÍCONE DO APP
 *
 *   node server/icones.js
 *
 * O logo original tem margem transparente em volta. Num ícone de PWA
 * isso vira moldura escura: o Android compõe o transparente sobre o
 * fundo do launcher e o iOS sobre preto. O ícone precisa sangrar — cor
 * até a última borda.
 *
 * Então este script recorta a margem vazia do PNG, escala o desenho para
 * caber na zona segura do formato maskable (80% do quadro, o resto o
 * sistema pode cortar em círculo) e assenta tudo sobre o azul da marca.
 *
 * Sem dependência: PNG é deflate com filtros por linha, e o zlib já vem
 * no Node.
 * ============================================================
 */

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const WEB = join(raiz, 'web');

/* ---------- ler ---------- */
function lePng(buf) {
  let p = 8, larg = 0, alt = 0, prof = 0, tipo = 0;
  const partes = [];
  while (p < buf.length) {
    const tam = buf.readUInt32BE(p), nome = buf.toString('ascii', p + 4, p + 8);
    const corpo = buf.subarray(p + 8, p + 8 + tam);
    if (nome === 'IHDR') {
      larg = corpo.readUInt32BE(0); alt = corpo.readUInt32BE(4);
      prof = corpo[8]; tipo = corpo[9];
    }
    if (nome === 'IDAT') partes.push(corpo);
    if (nome === 'IEND') break;
    p += 12 + tam;
  }
  if (prof !== 8 || (tipo !== 6 && tipo !== 2)) {
    throw new Error(`PNG tipo ${tipo}/${prof} bits não suportado — salve como RGB ou RGBA de 8 bits`);
  }
  const canais = tipo === 6 ? 4 : 3;
  const bruto = zlib.inflateSync(Buffer.concat(partes));
  const px = Buffer.alloc(larg * alt * 4);
  const linha = larg * canais;
  let ant = Buffer.alloc(linha);

  for (let y = 0; y < alt; y++) {
    const base = y * (linha + 1);
    const f = bruto[base];
    const atual = Buffer.from(bruto.subarray(base + 1, base + 1 + linha));
    // desfaz o filtro daquela linha (a parte que todo mundo esquece)
    for (let i = 0; i < linha; i++) {
      const a = i >= canais ? atual[i - canais] : 0;
      const b = ant[i];
      const c = i >= canais ? ant[i - canais] : 0;
      if (f === 1) atual[i] = (atual[i] + a) & 255;
      else if (f === 2) atual[i] = (atual[i] + b) & 255;
      else if (f === 3) atual[i] = (atual[i] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        atual[i] = (atual[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    for (let x = 0; x < larg; x++) {
      const s = x * canais, d = (y * larg + x) * 4;
      px[d] = atual[s]; px[d + 1] = atual[s + 1]; px[d + 2] = atual[s + 2];
      px[d + 3] = canais === 4 ? atual[s + 3] : 255;
    }
    ant = atual;
  }
  return { larg, alt, px };
}

/* ---------- escrever ---------- */
const TABELA = [...Array(256)].map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = 0xFFFFFFFF;
  for (const x of b) c = TABELA[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) | 0;
};

function escrevePng(larg, alt, px) {
  const bruto = Buffer.alloc(alt * (larg * 4 + 1));
  for (let y = 0; y < alt; y++) {
    bruto[y * (larg * 4 + 1)] = 0;
    px.copy(bruto, y * (larg * 4 + 1) + 1, y * larg * 4, (y + 1) * larg * 4);
  }
  const pedaco = (nome, corpo) => {
    const b = Buffer.alloc(12 + corpo.length);
    b.writeUInt32BE(corpo.length, 0);
    b.write(nome, 4, 'ascii');
    corpo.copy(b, 8);
    b.writeInt32BE(crc(Buffer.concat([Buffer.from(nome, 'ascii'), corpo])), 8 + corpo.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(larg, 0);
  ihdr.writeUInt32BE(alt, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pedaco('IHDR', ihdr),
    pedaco('IDAT', zlib.deflateSync(bruto, { level: 9 })),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- recorte, escala e fundo ---------- */

/** Acha a caixa do desenho: onde o alfa deixa de ser zero. */
function caixaUtil({ larg, alt, px }) {
  let x0 = larg, y0 = alt, x1 = -1, y1 = -1;
  for (let y = 0; y < alt; y++) {
    for (let x = 0; x < larg; x++) {
      if (px[(y * larg + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x0: 0, y0: 0, x1: larg - 1, y1: alt - 1 };
  return { x0, y0, x1, y1 };
}

/**
 * Reduz por media de area, nao por vizinho mais proximo: o logo tem
 * curvas, e vizinho mais proximo devolve escada.
 */
function encaixa(origem, caixa, destino, ocupa) {
  const { larg, px } = origem;
  const lo = caixa.x1 - caixa.x0 + 1, ao = caixa.y1 - caixa.y0 + 1;
  const lado = Math.round(destino * ocupa);
  const escala = Math.min(lado / lo, lado / ao);
  const lf = Math.round(lo * escala), af = Math.round(ao * escala);
  const ox = Math.round((destino - lf) / 2), oy = Math.round((destino - af) / 2);
  const saida = Buffer.alloc(destino * destino * 4);

  for (let y = 0; y < af; y++) {
    for (let x = 0; x < lf; x++) {
      const sx0 = caixa.x0 + Math.floor(x / escala), sx1 = caixa.x0 + Math.floor((x + 1) / escala);
      const sy0 = caixa.y0 + Math.floor(y / escala), sy1 = caixa.y0 + Math.floor((y + 1) / escala);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy <= Math.min(sy1, caixa.y1); sy++) {
        for (let sx = sx0; sx <= Math.min(sx1, caixa.x1); sx++) {
          const s = (sy * larg + sx) * 4;
          const al = px[s + 3] / 255;
          r += px[s] * al; g += px[s + 1] * al; b += px[s + 2] * al; a += px[s + 3];
          n++;
        }
      }
      if (!n) continue;
      const d = ((y + oy) * destino + (x + ox)) * 4;
      const am = a / n;
      const peso = am > 0 ? (a / 255) : 1;
      saida[d] = Math.round(r / peso); saida[d + 1] = Math.round(g / peso);
      saida[d + 2] = Math.round(b / peso); saida[d + 3] = Math.round(am);
    }
  }
  return saida;
}

/** O azul da marca, do canto de cima ao de baixo. */
function fundo(lado) {
  const px = Buffer.alloc(lado * lado * 4);
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const t = (x / lado) * 0.35 + (y / lado) * 0.65;
      const d = (y * lado + x) * 4;
      px[d] = Math.round(11 + (27 - 11) * t);
      px[d + 1] = Math.round(108 + (64 - 108) * t);
      px[d + 2] = Math.round(247 + (230 - 247) * t);
      px[d + 3] = 255;
    }
  }
  return px;
}

/** Assenta o desenho sobre o fundo, respeitando a transparencia. */
function assenta(base, frente, lado) {
  const saida = Buffer.from(base);
  for (let i = 0; i < lado * lado; i++) {
    const d = i * 4;
    const a = frente[d + 3] / 255;
    if (!a) continue;
    saida[d] = Math.round(frente[d] * a + saida[d] * (1 - a));
    saida[d + 1] = Math.round(frente[d + 1] * a + saida[d + 1] * (1 - a));
    saida[d + 2] = Math.round(frente[d + 2] * a + saida[d + 2] * (1 - a));
    saida[d + 3] = 255;
  }
  return saida;
}

const fonte = lePng(readFileSync(join(WEB, 'logo.png')));
const caixa = caixaUtil(fonte);
console.log(`  logo ${fonte.larg}x${fonte.alt} — desenho util ${caixa.x1 - caixa.x0 + 1}x${caixa.y1 - caixa.y0 + 1}`);

// maskable: o desenho ocupa 62% do quadro. O sistema pode cortar ate 20%
// de cada lado em circulo, e nada do simbolo pode cair nessa faixa.
// O proprio logo ja e um quadrado arredondado: ele ocupa o quadro inteiro
// e o gradiente so preenche os cantos que a borda arredondada deixa vazios.
// E dai que vinha a moldura escura — canto transparente sobre fundo preto.
//
// No maskable o desenho recua para 78%: o sistema pode cortar em circulo,
// e nada da marca pode cair na faixa que ele apara.
for (const [nome, lado, ocupa] of [
  ['icone-512.png', 512, 1],
  ['icone-192.png', 192, 1],
  ['icone-maskable.png', 512, 0.78],
]) {
  const arte = encaixa(fonte, caixa, lado, ocupa);
  writeFileSync(join(WEB, nome), escrevePng(lado, lado, assenta(fundo(lado), arte, lado)));
  console.log(`  ${nome}  ${lado}x${lado}  cor ate a borda`);
}
console.log('');
