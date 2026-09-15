/* ============================================================
   Silhuetas de embalagem.
   A caixa de remédio é o que o cliente reconhece antes de ler o nome —
   então cada forma farmacêutica tem um desenho diferente: caixa,
   frasco, tubo, pacote. É o que faz a grade parecer prateleira.
   ============================================================ */

const tom = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const m = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${m((n >> 16) & 255)},${m((n >> 8) & 255)},${m(n & 255)})`;
};

const SOMBRA = (cx, rx) =>
  `<ellipse cx="${cx}" cy="112" rx="${rx}" ry="6" fill="#08130F" opacity=".13"/>`;

const PAPEL = (id) => `
  <linearGradient id="p${id}" x1="0" y1="0" x2=".35" y2="1">
    <stop offset="0" stop-color="#FFFFFF"/><stop offset=".55" stop-color="#FBFCFA"/>
    <stop offset="1" stop-color="#EAEFEB"/>
  </linearGradient>`;

function caixa(id, cor, rx) {
  const lado = tom(cor, .74), topo = tom(cor, 1.18);
  return `
  ${SOMBRA(78, 33)}
  <!-- tampa -->
  <path d="M46 34 L59 25 L109 25 L96 34 Z" fill="${topo}" opacity=".92"/>
  <path d="M46 34 L59 25 L109 25 L96 34 Z" fill="#FFFFFF" opacity=".55"/>
  <!-- lateral -->
  <path d="M96 34 L109 25 L109 97 L96 106 Z" fill="url(#l${id})"/>
  <!-- frente -->
  <rect x="46" y="34" width="50" height="72" fill="url(#p${id})"/>
  <rect x="46" y="34" width="50" height="16" fill="${cor}"/>
  <rect x="50.5" y="38" width="9" height="9" rx="1.6" fill="#FFFFFF" opacity=".88"/>
  <rect x="62" y="40" width="22" height="2.6" rx="1.3" fill="#FFFFFF" opacity=".6"/>
  <rect x="62" y="45" width="13" height="2" rx="1" fill="#FFFFFF" opacity=".35"/>
  <rect x="51" y="57" width="35" height="4.2" rx="2.1" fill="#08130F" opacity=".76"/>
  <rect x="51" y="65" width="23" height="3.2" rx="1.6" fill="#08130F" opacity=".32"/>
  <rect x="51" y="73" width="15" height="3" rx="1.5" fill="${lado}" opacity=".85"/>
  ${rx ? `<rect x="46" y="84" width="50" height="7" fill="#C8102E"/>
         <rect x="46" y="84" width="50" height="1" fill="#FFFFFF" opacity=".35"/>` : ''}
  <rect x="51" y="${rx ? 96 : 86}" width="19" height="2.6" rx="1.3" fill="#08130F" opacity=".2"/>
  <rect x="46" y="34" width="2.6" height="72" fill="#FFFFFF" opacity=".9"/>
  <rect x="46" y="34" width="50" height="72" fill="none" stroke="#08130F" stroke-opacity=".10" stroke-width=".9"/>`;
}

function frasco(id, cor) {
  const tampa = tom(cor, .66);
  return `
  ${SOMBRA(75, 27)}
  <rect x="62" y="21" width="26" height="15" rx="3.5" fill="${tampa}"/>
  <rect x="62" y="21" width="26" height="4.5" rx="2.2" fill="#FFFFFF" opacity=".22"/>
  <rect x="64.5" y="24" width="3" height="9" rx="1.5" fill="#FFFFFF" opacity=".25"/>
  <rect x="67" y="36" width="16" height="8" fill="#DCE5DF"/>
  <path d="M55 52 q0-8 8-8 h24 q8 0 8 8 v46 q0 8 -8 8 h-24 q-8 0 -8 -8 z"
        fill="url(#p${id})" stroke="#08130F" stroke-opacity=".10" stroke-width=".9"/>
  <rect x="57.5" y="50" width="3.4" height="52" rx="1.7" fill="#FFFFFF" opacity=".92"/>
  <rect x="55" y="62" width="40" height="30" fill="${cor}" opacity=".16"/>
  <rect x="55" y="62" width="40" height="3" fill="${cor}"/>
  <rect x="62" y="70" width="26" height="3.8" rx="1.9" fill="#08130F" opacity=".64"/>
  <rect x="62" y="78" width="16" height="3" rx="1.5" fill="#08130F" opacity=".3"/>
  <rect x="62" y="85" width="21" height="2.4" rx="1.2" fill="${tampa}" opacity=".7"/>`;
}

function tubo(id, cor) {
  const tampa = tom(cor, .68);
  return `
  ${SOMBRA(75, 24)}
  <rect x="66" y="19" width="18" height="14" rx="2.6" fill="${tampa}"/>
  <rect x="66" y="19" width="18" height="4" rx="2" fill="#FFFFFF" opacity=".2"/>
  <path d="M59 33 h32 v58 q0 5 -2 7 l-1.5 8 h-25 l-1.5 -8 q-2 -2 -2 -7 z"
        fill="url(#p${id})" stroke="#08130F" stroke-opacity=".10" stroke-width=".9"/>
  <rect x="61.5" y="35" width="3.2" height="56" rx="1.6" fill="#FFFFFF" opacity=".92"/>
  <path d="M62.5 98 h25 l-1 8 h-23 z" fill="${tom(cor, .88)}" opacity=".6"/>
  <path d="M64 99.5 l3 5 M69 99.5 l3 5 M74 99.5 l3 5 M79 99.5 l3 5"
        stroke="#08130F" stroke-opacity=".12" stroke-width="1"/>
  <rect x="59" y="46" width="32" height="28" fill="${cor}" opacity=".18"/>
  <rect x="59" y="46" width="32" height="3" fill="${cor}"/>
  <rect x="64" y="54" width="22" height="3.8" rx="1.9" fill="#08130F" opacity=".62"/>
  <rect x="64" y="62" width="13" height="3" rx="1.5" fill="#08130F" opacity=".28"/>`;
}

function pacote(id, cor) {
  return `
  ${SOMBRA(75, 35)}
  <path d="M41 40 q34 -11 68 0 v50 q0 14 -10 14 h-48 q-10 0 -10 -14 z"
        fill="url(#p${id})" stroke="#08130F" stroke-opacity=".10" stroke-width=".9"/>
  <path d="M41 40 q34 -11 68 0 v9 q-34 -11 -68 0 z" fill="${cor}"/>
  <path d="M41 40 q34 -11 68 0 v3 q-34 -11 -68 0 z" fill="#FFFFFF" opacity=".3"/>
  <circle cx="60" cy="72" r="12" fill="${cor}" opacity=".18"/>
  <circle cx="60" cy="72" r="6" fill="${cor}" opacity=".3"/>
  <rect x="78" y="64" width="24" height="4" rx="2" fill="#08130F" opacity=".6"/>
  <rect x="78" y="72" width="16" height="3.2" rx="1.6" fill="#08130F" opacity=".28"/>
  <rect x="78" y="79" width="20" height="2.6" rx="1.3" fill="${cor}" opacity=".6"/>
  <rect x="44" y="44" width="3" height="52" rx="1.5" fill="#FFFFFF" opacity=".8"/>`;
}

let seq = 0;
/** Devolve o SVG da embalagem do produto. */
/**
 * O desenho é o plano B, não o plano A.
 *
 * Se a loja subiu a foto real da caixa, é ela que aparece — o vetor
 * existe para o catálogo nunca ficar com buraco enquanto as fotos não
 * chegam. Foto quebrada volta para o desenho sozinha.
 */
export function embalagem(p, { perto = false } = {}) {
  if (p?.imagem_url) {
    return `<img class="foto-prod" src="${String(p.imagem_url).replace(/"/g, '&quot;')}"
      alt="" loading="lazy" decoding="async"
      onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'sem-foto'}))">`;
  }
  const id = ++seq;
  const cor = p?.cor || '#3E7D5A';
  const rx = p?.tarja === 'vermelha' || p?.requer_receita;
  const forma = p?.forma || 'caixa';
  const corpo = forma === 'frasco' ? frasco(id, cor)
    : forma === 'tubo' ? tubo(id, cor)
    : forma === 'pacote' ? pacote(id, cor)
    : caixa(id, cor, rx);
  // miniatura usa recorte fechado: a embalagem ocupa o quadro todo
  const vb = perto ? '38 17 80 100' : '0 0 150 128';
  return `<svg viewBox="${vb}" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
    <defs>${PAPEL(id)}
      <linearGradient id="l${id}" x1="0" y1="0" x2="1" y2=".2">
        <stop offset="0" stop-color="${tom(cor, .62)}"/><stop offset="1" stop-color="${tom(cor, .86)}"/>
      </linearGradient></defs>${corpo}</svg>`;
}

/* ---------- pictogramas de categoria ----------
   Emoji em círculo é o atalho que denuncia protótipo. Traço próprio,
   mesma espessura em todos, cor puxada da categoria.              */
const T = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
const GLIFO = {
  dor: `<path ${T} d="M12 4.2v9.4"/><circle cx="12" cy="16.6" r="3.1" ${T}/><path ${T} d="M9.3 6.4h2.7M9.3 9.2h2.7"/><path ${T} d="M12 4.2a2.6 2.6 0 0 1 2.6 2.6v7.4"/>`,
  pressao: `<path ${T} d="M12 20s-7-4.4-7-9.3A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.7C19 15.6 12 20 12 20z"/><path ${T} d="M5.6 13.4h3.1l1.5-2.6 1.8 4.4 1.4-2.6h4.9"/>`,
  antibiotico: `<rect x="3.4" y="9.2" width="17.2" height="5.6" rx="2.8" ${T} transform="rotate(-38 12 12)"/><path ${T} d="M9.2 9.2l5.6 5.6"/>`,
  dermo: `<path ${T} d="M12 3.6s5.6 6 5.6 9.6A5.6 5.6 0 0 1 12 18.8a5.6 5.6 0 0 1-5.6-5.6C6.4 9.6 12 3.6 12 3.6z"/><path ${T} d="M9.6 13.6a2.4 2.4 0 0 0 2.4 2.4"/>`,
  vitaminas: `<circle cx="12" cy="12" r="4.4" ${T}/><path ${T} d="M12 3.6v1.8M12 18.6v1.8M3.6 12h1.8M18.6 12h1.8M6.1 6.1l1.3 1.3M16.6 16.6l1.3 1.3M17.9 6.1l-1.3 1.3M7.4 16.6l-1.3 1.3"/>`,
  bebe: `<path ${T} d="M9 4.4h6l-.7 2.4H9.7z"/><path ${T} d="M8.4 6.8h7.2v9.8a3.4 3.4 0 0 1-3.4 3.4h-.4a3.4 3.4 0 0 1-3.4-3.4z"/><path ${T} d="M8.4 11.4h7.2"/>`,
  higiene: `<path ${T} d="M7.6 9.4h8.8v8.2a2.4 2.4 0 0 1-2.4 2.4h-4a2.4 2.4 0 0 1-2.4-2.4z"/><path ${T} d="M10 9.4V6.2a2 2 0 0 1 4 0v3.2"/><path ${T} d="M9.4 13.6h5.2"/>`,
  refrigerado: `<path ${T} d="M12 3.8v16.4M4.9 7.9l14.2 8.2M19.1 7.9L4.9 16.1"/><path ${T} d="M12 6.9l1.9 1.5M12 6.9l-1.9 1.5M12 17.1l1.9-1.5M12 17.1l-1.9-1.5"/>`,
  gripe: `<path ${T} d="M8.6 4.6v6.2c0 1-.5 1.6-1.3 2.3A4.4 4.4 0 0 0 10 20.4h4.4a4.4 4.4 0 0 0 2.6-7.3c-.8-.7-1.3-1.3-1.3-2.3V4.6z"/><path ${T} d="M8.6 4.6h6.9"/>`,
  outro: `<circle cx="12" cy="12" r="7.4" ${T}/><path ${T} d="M12 8.4v4.4M12 15.6h.01"/>`,
};
export const CATS = {
  dor:         ['Dor e febre',  '#C8102E', 'dor'],
  gripe:       ['Gripe',        '#2E7CC4', 'gripe'],
  pressao:     ['Pressão',      '#A03050', 'pressao'],
  antibiotico: ['Antibióticos', '#1E8E6A', 'antibiotico'],
  dermo:       ['Dermo',        '#E8A33D', 'dermo'],
  vitaminas:   ['Vitaminas',    '#E07A1F', 'vitaminas'],
  bebe:        ['Bebê',         '#4FA8C7', 'bebe'],
  higiene:     ['Higiene',      '#5B7FA8', 'higiene'],
  refrigerado: ['Refrigerados', '#2F86C7', 'refrigerado'],
};
export function pictograma(cat) {
  const [, , g] = CATS[cat] || ['', '', 'outro'];
  return `<svg width="21" height="21" viewBox="0 0 24 24">${GLIFO[g] || GLIFO.outro}</svg>`;
}

/* ---------- ícones das abas ----------
   Cada aba tem duas versões: linha quando dorme, cheia quando acorda.
   É o que faz a barra responder ao toque em vez de só trocar de cor.   */
export const ABA = {
  casa: {
    linha: `<svg width="23" height="23" viewBox="0 0 24 24" ${T}><path d="M4 11l8-6.5 8 6.5v8.5a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/></svg>`,
    cheia: `<svg width="23" height="23" viewBox="0 0 24 24"><path fill="currentColor"
      d="M3.4 11.2 12 4.2l8.6 7a1 1 0 0 1 .4.8v7.6a1.4 1.4 0 0 1-1.4 1.4h-4.2v-5.4a1.2 1.2 0 0 0-1.2-1.2h-4.4a1.2 1.2 0 0 0-1.2 1.2V21H4.4A1.4 1.4 0 0 1 3 19.6V12a1 1 0 0 1 .4-.8z"/></svg>`,
  },
  busca: {
    linha: `<svg width="23" height="23" viewBox="0 0 24 24" ${T}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>`,
    cheia: `<svg width="23" height="23" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7.2" fill="currentColor" opacity=".24"/>
      <circle cx="11" cy="11" r="7.2" fill="none" stroke="currentColor" stroke-width="2.4"/>
      <path d="M20.2 20.2l-3.9-3.9" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`,
  },
  sacola: {
    linha: `<svg width="23" height="23" viewBox="0 0 24 24" ${T}><path d="M5 7h14l-1 13H6z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>`,
    cheia: `<svg width="23" height="23" viewBox="0 0 24 24"><path fill="currentColor"
      d="M5.6 6h12.8a1 1 0 0 1 1 1.1l-1 12.4a1.4 1.4 0 0 1-1.4 1.3H7a1.4 1.4 0 0 1-1.4-1.3l-1-12.4A1 1 0 0 1 5.6 6z"/>
      <path d="M9 7a3 3 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  },
  receita: {
    linha: `<svg width="23" height="23" viewBox="0 0 24 24" ${T}><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9.5 12h3.2a1.9 1.9 0 0 1 0 3.8H9.5V12zm3.2 3.8L15 18.5"/></svg>`,
    cheia: `<svg width="23" height="23" viewBox="0 0 24 24"><path fill="currentColor" d="M6 3h8.2L20 8.6V21H6z" opacity=".95"/>
      <path d="M13.6 3.4v5.2h5.2" fill="#fff" opacity=".55"/>
      <path d="M9.5 12h3.2a1.9 1.9 0 0 1 0 3.8H9.5V12zm3.2 3.8L15 18.5" fill="none" stroke="#fff"
        stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  },
  conta: {
    linha: `<svg width="23" height="23" viewBox="0 0 24 24" ${T}><circle cx="12" cy="8.4" r="3.9"/><path d="M4.8 20c0-3.6 3.2-5.6 7.2-5.6s7.2 2 7.2 5.6"/></svg>`,
    cheia: `<svg width="23" height="23" viewBox="0 0 24 24"><circle cx="12" cy="8.2" r="4.2" fill="currentColor"/>
      <path fill="currentColor" d="M4.6 20.4c0-3.9 3.3-6 7.4-6s7.4 2.1 7.4 6a.9.9 0 0 1-.9.9H5.5a.9.9 0 0 1-.9-.9z"/></svg>`,
  },
};

/* ---------- ícones de interface ---------- */
export const IC = {
  busca: `<svg width="20" height="20" viewBox="0 0 24 24" ${T}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>`,
  casa: `<svg width="21" height="21" viewBox="0 0 24 24" ${T}><path d="M4 11l8-6.5 8 6.5v8.5a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/></svg>`,
  receita: `<svg width="21" height="21" viewBox="0 0 24 24" ${T}><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9.5 12h3.2a1.9 1.9 0 0 1 0 3.8H9.5V12zm3.2 3.8L15 18.5"/></svg>`,
  sacola: `<svg width="21" height="21" viewBox="0 0 24 24" ${T}><path d="M5 7h14l-1 13H6z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>`,
  carrinho: `<svg width="18" height="18" viewBox="0 0 24 24" ${T}><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H6"/><circle cx="10" cy="20" r="1.2"/><circle cx="18" cy="20" r="1.2"/></svg>`,
  volta: `<svg width="17" height="17" viewBox="0 0 24 24" ${T}><path d="M15 5l-7 7 7 7"/></svg>`,
  seta: `<svg width="16" height="16" viewBox="0 0 24 24" ${T}><path d="M9 5l7 7-7 7"/></svg>`,
  mais: `<svg width="15" height="15" viewBox="0 0 24 24" ${T} stroke-width="2.6"><path d="M12 5v14M5 12h14"/></svg>`,
  camera: `<svg width="22" height="22" viewBox="0 0 24 24" ${T}><path d="M3 8h3.2l1.6-2.4h8.4L17.8 8H21v11H3z"/><circle cx="12" cy="13.4" r="3.6"/></svg>`,
  relogio: `<svg width="16" height="16" viewBox="0 0 24 24" ${T}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/></svg>`,
  cruz: `<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M12 2h8a2 2 0 0 1 2 2v6h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6v6a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-6H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h6V4a2 2 0 0 1 2-2z"/></svg>`,
  troca: `<svg width="17" height="17" viewBox="0 0 24 24" ${T}><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>`,
  telefone: `<svg width="19" height="19" viewBox="0 0 24 24" ${T}><path d="M4.5 5.5c0 8 6 14 14 14l2-3-4-2-2 2a13 13 0 0 1-5-5l2-2-2-4z"/></svg>`,
  balao: `<svg width="19" height="19" viewBox="0 0 24 24" ${T}><path d="M20 15.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5z"/></svg>`,
  sino: `<svg width="19" height="19" viewBox="0 0 24 24" ${T}><path d="M18 16H6l1.4-2V10a4.6 4.6 0 0 1 9.2 0v4z"/><path d="M10.2 19a1.9 1.9 0 0 0 3.6 0"/></svg>`,
  armario: `<svg width="21" height="21" viewBox="0 0 24 24" ${T}><rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M12 3.5v17"/><path d="M9 9.6h.01M15 9.6h.01"/></svg>`,
  pix: `<svg width="21" height="21" viewBox="0 0 24 24" ${T}><path d="M12 3.2 20.8 12 12 20.8 3.2 12z"/><path d="M8.4 8.4 12 12l3.6-3.6M8.4 15.6 12 12l3.6 3.6"/></svg>`,
  cartao: `<svg width="21" height="21" viewBox="0 0 24 24" ${T}><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18"/></svg>`,
  copia: `<svg width="16" height="16" viewBox="0 0 24 24" ${T}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 6.5V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h1.5"/></svg>`,
  estrela: `<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.4l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.7l6-.8z"/></svg>`,
};
