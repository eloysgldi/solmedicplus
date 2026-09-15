/**
 * QR Code, à mão.
 *
 * O "copia e cola" resolve quem está no computador; quem está com o
 * celular na frente da maquininha precisa do quadrado. Como o projeto não
 * instala dependência, o gerador é este: modo byte, correção M, versão
 * escolhida pelo tamanho do payload. É o suficiente para BR Code de PIX,
 * que nunca passa de ~250 bytes.
 */

const GALOG = new Uint8Array(256), GEXP = new Uint8Array(512);
for (let i = 0, x = 1; i < 255; i++) { GEXP[i] = x; GALOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; }
for (let i = 255; i < 512; i++) GEXP[i] = GEXP[i - 255];
const mul = (a, b) => (a && b) ? GEXP[GALOG[a] + GALOG[b]] : 0;

/** Polinômio gerador do Reed-Solomon para n bytes de correção. */
function gerador(n) {
  let p = [1];
  for (let i = 0; i < n; i++) {
    const q = [...p, 0];
    for (let j = 0; j < p.length; j++) q[j + 1] ^= mul(p[j], GEXP[i]);
    p = q;
  }
  return p;
}

function correcao(dados, n) {
  const g = gerador(n);
  const r = new Uint8Array(dados.length + n);
  r.set(dados);
  for (let i = 0; i < dados.length; i++) {
    const c = r[i];
    if (!c) continue;
    for (let j = 0; j < g.length; j++) r[i + j] ^= mul(g[j], c);
  }
  return r.slice(dados.length);
}

// por versão (1..20), no nível M: [total de bytes, blocos do grupo 1, blocos do grupo 2]
const CAPM = [
  [16, 1, 0], [28, 1, 0], [44, 1, 0], [64, 2, 0], [86, 2, 0], [108, 4, 0], [124, 4, 0],
  [154, 2, 2], [182, 3, 2], [216, 4, 1], [254, 1, 4], [290, 6, 2], [334, 8, 1], [365, 4, 5],
  [415, 5, 5], [453, 7, 3], [507, 10, 1], [563, 9, 4], [627, 3, 11], [669, 3, 13],
];
const ECC_M = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 28];

const ALINHAMENTO = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38],
  [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
  [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82],
  [6, 30, 58, 86], [6, 34, 62, 90]];

/** Devolve uma matriz de 0/1. `texto` entra como UTF-8. */
export function qr(texto) {
  const bytes = new TextEncoder().encode(texto);
  let versao = CAPM.findIndex(([cap]) => cap >= bytes.length + (bytes.length < 256 ? 2 : 3)) + 1;
  if (!versao) throw new Error('Texto grande demais para um QR versão 20');
  if (versao < 10 && bytes.length + 2 > CAPM[versao - 1][0]) versao++;

  const [total, g1, g2] = CAPM[versao - 1];
  const nEcc = ECC_M[versao - 1];
  const blocos = g1 + g2;
  const base = Math.floor(total / blocos);

  // ---- bits: modo byte (0100), tamanho, dados, terminador, padding ----
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  put(4, 4);
  put(bytes.length, versao < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  for (let i = 0; i < 4 && bits.length < total * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const dados = [];
  for (let i = 0; i < bits.length; i += 8) {
    dados.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  }
  for (let i = 0; dados.length < total; i++) dados.push(i % 2 ? 0x11 : 0xEC);

  // ---- blocos e intercalação ----
  const partes = [], eccs = [];
  let p = 0;
  for (let i = 0; i < blocos; i++) {
    const n = base + (i >= g1 ? 1 : 0);
    const bloco = Uint8Array.from(dados.slice(p, p + n)); p += n;
    partes.push(bloco); eccs.push(correcao(bloco, nEcc));
  }
  const fluxo = [];
  for (let i = 0; i < Math.max(...partes.map((b) => b.length)); i++) {
    for (const b of partes) if (i < b.length) fluxo.push(b[i]);
  }
  for (let i = 0; i < nEcc; i++) for (const e of eccs) fluxo.push(e[i]);
  return desenha(versao, fluxo);
}

function desenha(versao, fluxo) {
  const n = versao * 4 + 17;
  const m = Array.from({ length: n }, () => new Int8Array(n).fill(-1));
  const fixo = (x, y, v) => { if (x >= 0 && y >= 0 && x < n && y < n) m[y][x] = v; };

  // três olhos + separadores
  for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    for (let y = -1; y <= 7; y++) for (let x = -1; x <= 7; x++) {
      const borda = x === -1 || y === -1 || x === 7 || y === 7;
      const anel = x === 0 || x === 6 || y === 0 || y === 6;
      const miolo = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      fixo(ox + x, oy + y, borda ? 0 : (anel || miolo) ? 1 : 0);
    }
  }
  // alinhamento
  const al = ALINHAMENTO[versao - 1];
  for (const cy of al) for (const cx of al) {
    if (m[cy][cx] !== -1) continue;
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
      m[cy + y][cx + x] = (Math.abs(x) === 2 || Math.abs(y) === 2 || (!x && !y)) ? 1 : 0;
    }
  }
  // temporizadores e o módulo escuro que sempre existe
  for (let i = 8; i < n - 8; i++) { m[6][i] = i % 2 ? 0 : 1; m[i][6] = i % 2 ? 0 : 1; }
  m[n - 8][8] = 1;

  const reservado = (x, y) => m[y][x] !== -1;
  // reserva o espaço do formato antes de escrever os dados
  for (let i = 0; i < 9; i++) { if (!reservado(i, 8)) m[8][i] = 0; if (!reservado(8, i)) m[i][8] = 0; }
  for (let i = 0; i < 8; i++) { if (!reservado(n - 1 - i, 8)) m[8][n - 1 - i] = 0;
                                if (!reservado(8, n - 1 - i)) m[n - 1 - i][8] = 0; }
  if (versao >= 7) {
    for (let i = 0; i < 18; i++) {
      const y = Math.floor(i / 3), x = n - 11 + (i % 3);
      m[y][x] = 0; m[x][y] = 0;
    }
  }

  // ---- zigue-zague da direita para a esquerda, com a máscara 0 ----
  let bit = 0, subindo = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < n; k++) {
      const y = subindo ? n - 1 - k : k;
      for (const x of [col, col - 1]) {
        if (m[y][x] !== -1) continue;
        const b = bit < fluxo.length * 8 ? (fluxo[bit >> 3] >> (7 - (bit & 7))) & 1 : 0;
        bit++;
        m[y][x] = ((y + x) % 2 === 0) ? b ^ 1 : b;   // máscara 0
      }
    }
    subindo = !subindo;
  }

  // ---- informação de formato: nível M (00) + máscara 0 ----
  let fmt = 0b00 << 3;
  let resto = fmt << 10;
  for (let i = 4; i >= 0; i--) if (resto & (1 << (i + 10))) resto ^= 0b10100110111 << i;
  fmt = ((fmt << 10) | resto) ^ 0b101010000010010;
  for (let i = 0; i < 15; i++) {
    const b = (fmt >> i) & 1;
    if (i < 6) { m[i][8] = b; m[8][n - 1 - i] = b; }
    else if (i < 8) { m[i + 1][8] = b; m[8][n - 8 + (i - 6)] = b; }
    else if (i === 8) { m[8][7] = b; m[n - 7][8] = b; }
    else { m[8][14 - i] = b; m[n - 15 + i][8] = b; }
  }
  // ---- informação de versão, a partir da 7 ----
  if (versao >= 7) {
    let r = versao << 12;
    for (let i = 5; i >= 0; i--) if (r & (1 << (i + 12))) r ^= 0b1111100100101 << i;
    const vi = (versao << 12) | r;
    for (let i = 0; i < 18; i++) {
      const b = (vi >> i) & 1, y = Math.floor(i / 3), x = n - 11 + (i % 3);
      m[y][x] = b; m[x][y] = b;
    }
  }
  return m.map((linha) => Array.from(linha, (v) => (v === 1 ? 1 : 0)));
}

/** O QR como SVG, pronto para entrar no HTML. Uma path só: nada de 900 <rect>. */
export function qrSvg(texto, { tam = 220, margem = 4 } = {}) {
  const m = qr(texto);
  const n = m.length + margem * 2;
  let d = '';
  m.forEach((linha, y) => linha.forEach((v, x) => {
    if (v) d += `M${x + margem} ${y + margem}h1v1h-1z`;
  }));
  return `<svg viewBox="0 0 ${n} ${n}" width="${tam}" height="${tam}" role="img"
    aria-label="QR Code para pagar com PIX" shape-rendering="crispEdges">
    <rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#07101E"/></svg>`;
}
