/**
 * Pedaços visuais que as telas do painel dividem entre si.
 *
 * Nada aqui sabe o que é um pedido ou um cliente: são formatadores e
 * três desenhos. É o que impede cada tela nova de reinventar o mesmo
 * "R$" com vírgula errada.
 */

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const brl = (c) => 'R$ ' + ((c ?? 0) / 100).toFixed(2).replace('.', ',');

/** Valor de painel: 12,4 mil em vez de 1.240.000 centavos na sua cara. */
export function curto(centavos) {
  const v = (centavos ?? 0) / 100;
  if (Math.abs(v) >= 1000000) return 'R$ ' + (v / 1000000).toFixed(1).replace('.', ',') + ' mi';
  if (Math.abs(v) >= 1000) return 'R$ ' + (v / 1000).toFixed(1).replace('.', ',') + ' mil';
  return brl(centavos);
}

export const dataBR = (iso) => iso
  ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('pt-BR') : '—';

export const horaBR = (iso) => iso
  ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

/** "há 3 dias" diz mais do que 12/09/2026 quando o assunto é sumiço. */
export function quando(iso) {
  if (!iso) return 'nunca';
  const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
  if (d <= 0) return 'hoje';
  if (d === 1) return 'ontem';
  if (d < 30) return `há ${d} dias`;
  if (d < 60) return 'há 1 mês';
  if (d < 365) return `há ${Math.floor(d / 30)} meses`;
  return `há ${Math.floor(d / 365)} ano(s)`;
}

export const iniciais = (nome) => String(nome ?? '?').trim().split(/\s+/)
  .slice(0, 2).map((p) => p[0]).join('').toUpperCase();

/** Cor estável por nome: a mesma pessoa tem sempre o mesmo avatar. */
export function corDoNome(nome) {
  let h = 0;
  for (const c of String(nome ?? '')) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 46% 42%)`;
}

export function variacao(pct) {
  if (pct === null || pct === undefined) return '';
  const alta = pct >= 0;
  return `<span class="var ${alta ? 'sobe' : 'desce'}">${alta ? '▲' : '▼'} ${Math.abs(pct)}%</span>`;
}

/**
 * A série de 14 dias como área, não como tabela.
 *
 * É um desenho pequeno de propósito: serve para ver a forma — subiu,
 * caiu, teve um buraco na terça — e não para ler valor exato. Quem quer
 * o valor passa o mouse.
 */
export function serie(pontos, { altura = 68, chave = 'bruto_centavos' } = {}) {
  if (!pontos?.length) return '';
  const vals = pontos.map((p) => p[chave] ?? 0);
  const teto = Math.max(...vals, 1);
  const larg = 100 / (pontos.length - 1 || 1);
  const pts = vals.map((v, i) => `${(i * larg).toFixed(2)},${(100 - (v / teto) * 88).toFixed(2)}`);
  return `
  <svg class="serie" viewBox="0 0 100 100" preserveAspectRatio="none"
       style="height:${altura}px" aria-hidden="true">
    <defs><linearGradient id="grad-serie" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--brand-2)" stop-opacity=".28"/>
      <stop offset="1" stop-color="var(--brand-2)" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="0,100 ${pts.join(' ')} 100,100" fill="url(#grad-serie)"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="var(--brand)"
      stroke-width="1.6" vector-effect="non-scaling-stroke"
      stroke-linejoin="round" stroke-linecap="round"/>
  </svg>
  <div class="serie-dias">${pontos.map((p, i) => `
    <span title="${dataBR(p.dia)} · ${brl(p[chave] ?? 0)} · ${p.pedidos ?? 0} pedidos">
      ${i % 2 === 0 ? Number(p.dia.slice(8, 10)) : ''}</span>`).join('')}</div>`;
}

/** Barra de proporção. Serve para curva ABC e para segmento de cliente. */
export const barra = (pct, cor = 'var(--brand-2)') =>
  `<span class="barra"><i style="width:${Math.max(1, Math.min(100, pct))}%;background:${cor}"></i></span>`;

/** Selo de validade: a cor já conta a história antes de o número ser lido. */
export function seloValidade(dias) {
  if (dias === null || dias === undefined) return '<span class="pill">sem validade</span>';
  if (dias < 0) return `<span class="pill vencido">venceu há ${Math.abs(dias)}d</span>`;
  if (dias <= 60) return `<span class="pill critico">vence em ${dias}d</span>`;
  if (dias <= 180) return `<span class="pill atencao">vence em ${dias}d</span>`;
  return `<span class="pill">${dias}d</span>`;
}
