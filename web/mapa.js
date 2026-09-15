/* ============================================================
   MAPA
   Desenhado em vetor, não é tile de mapa de verdade: roda offline,
   não vaza endereço para servidor nenhum e fica mais limpo na tela
   pequena. A malha é fixa de propósito — mapa que muda de forma a
   cada render dá a sensação de erro.
   ============================================================ */

// a malha desce bem além da rota: a folha cobre a parte de baixo, e mapa
// que "acaba" no meio da tela denuncia o truque
const L = 360, A = 470;

/* quarteirões numa grade; as frestas entre eles são as ruas */
const COLUNAS = [6, 78, 150, 222, 294];
const LINHAS = [6, 68, 130, 192, 254, 316, 378, 440];
const LARG = 64, ALT = 54;

/* o trajeto: sai da farmácia, pega a avenida, entra na transversal */
const ROTA = 'M 44 272 L 44 226 L 116 226 L 116 166 L 188 166 L 188 104 L 300 104 L 300 58';

function quarteiroes() {
  let d = '';
  for (const [ci, x] of COLUNAS.entries()) {
    for (const [li, y] of LINHAS.entries()) {
      if (ci === 3 && li === 1) continue;            // praça
      if (ci === 1 && li === 4) continue;            // praça
      const w = ci === 2 ? LARG - 10 : LARG;
      d += `<rect x="${x}" y="${y}" width="${w}" height="${ALT}" rx="7" fill="var(--mapa-bloco)"/>`;
    }
  }
  return d;
}

function ruas() {
  let d = '';
  // avenida larga, no eixo do trajeto
  d += `<path d="M 44 470 L 44 36" stroke="var(--mapa-via)" stroke-width="13" stroke-linecap="round" fill="none"/>`;
  d += `<path d="M 0 226 L 360 226" stroke="var(--mapa-via)" stroke-width="13" stroke-linecap="round" fill="none"/>`;
  // transversais
  for (const y of [36, 104, 166, 288, 350, 412]) {
    d += `<path d="M 0 ${y} L 360 ${y}" stroke="var(--mapa-via)" stroke-width="8" stroke-linecap="round" fill="none"/>`;
  }
  for (const x of [116, 188, 260, 332]) {
    d += `<path d="M ${x} 0 L ${x} 470" stroke="var(--mapa-via)" stroke-width="8" stroke-linecap="round" fill="none"/>`;
  }
  // faixa central da avenida, tracejada — o detalhe que faz parecer mapa
  d += `<path d="M 44 470 L 44 36" stroke="var(--mapa-faixa)" stroke-width="1.4"
          stroke-dasharray="7 9" fill="none" opacity=".8"/>`;
  return d;
}

export function criaMapa(container, { progresso = 0, origem = 'Farmácia', destino = 'Casa' } = {}) {
  container.innerHTML = `
  <svg class="mapa-svg" viewBox="0 0 ${L} ${A}" preserveAspectRatio="xMidYMin meet" aria-hidden="true">
    <defs>
      <filter id="sombraPino" x="-60%" y="-60%" width="220%" height="220%">
        <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#071F5E" flood-opacity=".32"/>
      </filter>
      <linearGradient id="gRota" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="#2E6BFF"/><stop offset="1" stop-color="#7FB0FF"/>
      </linearGradient>
    </defs>

    <rect width="${L}" height="${A}" fill="var(--mapa-fundo)"/>
    <g class="mapa-camera">
      ${quarteiroes()}
      <rect x="222" y="68" width="${LARG}" height="${ALT}" rx="10" fill="var(--mapa-praca)"/>
      <rect x="78" y="254" width="${LARG}" height="${ALT}" rx="10" fill="var(--mapa-praca)"/>
      <path d="M 300 470 Q 336 380 318 286 Q 304 196 344 130" stroke="var(--mapa-agua)"
            stroke-width="17" fill="none" stroke-linecap="round" opacity=".9"/>
      ${ruas()}

      <path class="rota-base" d="${ROTA}" fill="none" stroke="var(--mapa-rota-base)"
            stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
      <path class="rota" d="${ROTA}" fill="none" stroke="url(#gRota)"
            stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>

      <!-- o ponto de partida é a farmácia, então o pino é a própria marca -->
      <g class="pino-origem" filter="url(#sombraPino)">
        <circle cx="44" cy="272" r="13.5" fill="#fff"/>
        <circle cx="44" cy="272" r="13.5" fill="none" stroke="var(--brand)" stroke-width="2"/>
        <g transform="translate(44 272) scale(0.2) translate(-50 -50)"
           fill="none" stroke="var(--brand)" stroke-width="19" stroke-linecap="round">
          <path d="M53.5 28.5 C53.5 43.5 34 39.5 27.7 50.5"/>
          <path d="M46.5 71.5 C46.5 56.5 66 60.5 72.3 49.5"/>
        </g>
      </g>

      <g class="pino-destino" filter="url(#sombraPino)">
        <path d="M300 44 c7.2 0 13 5.6 13 12.6 0 8.6-13 20.4-13 20.4s-13-11.8-13-20.4C287 49.6 292.8 44 300 44z"
              fill="var(--brand)"/>
        <circle cx="300" cy="56.6" r="4.6" fill="#fff"/>
      </g>

      <g class="moto">
        <circle class="moto-pulso" r="21" fill="var(--brand-2)" opacity=".18"/>
        <circle r="15" fill="#fff" filter="url(#sombraPino)"/>
        <circle r="12" fill="var(--brand-2)"/>
        <g class="moto-glifo">
          <path d="M-5 2.2 h3.4 l2-4.4 h3.2 l1 2.2 h2" stroke="#fff" stroke-width="1.7"
                fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="-5.2" cy="3.6" r="2.4" fill="none" stroke="#fff" stroke-width="1.6"/>
          <circle cx="5.4" cy="3.6" r="2.4" fill="none" stroke="#fff" stroke-width="1.6"/>
        </g>
      </g>
    </g>
  </svg>`;

  const svg = container.querySelector('svg');
  const rota = svg.querySelector('.rota');
  const moto = svg.querySelector('.moto');
  const camera = svg.querySelector('.mapa-camera');
  const total = rota.getTotalLength();
  rota.style.strokeDasharray = total;

  let atual = Math.max(0, Math.min(1, progresso));
  let quadro = null;

  function posiciona(t) {
    const p = rota.getPointAtLength(total * t);
    const q = rota.getPointAtLength(Math.min(total, total * t + 1.2));
    const ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
    // a moto vira, mas o glifo fica de pé: motoboy não anda de cabeça para baixo
    moto.setAttribute('transform', `translate(${p.x} ${p.y})`);
    moto.querySelector('.moto-glifo').setAttribute('transform', `scale(${Math.cos(ang * Math.PI / 180) < 0 ? -1 : 1} 1)`);
    rota.style.strokeDashoffset = total * (1 - t);
    // câmera anda um pouco junto — vida sem desorientar
    camera.setAttribute('transform', `translate(${(0.5 - t) * 16} ${(t - 0.5) * 12})`);
  }

  posiciona(atual);

  return {
    get progresso() { return atual; },
    /** Leva a moto até `alvo` em `ms`, com a mesma curva do resto do app. */
    anima(alvo, ms = 1400) {
      cancelAnimationFrame(quadro);
      const de = atual, delta = Math.max(0, Math.min(1, alvo)) - de;
      if (Math.abs(delta) < 0.001) return;
      const t0 = performance.now();
      const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (calmo) { atual = de + delta; return posiciona(atual); }
      const passo = (agora) => {
        const k = Math.min(1, (agora - t0) / ms);
        const suave = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        atual = de + delta * suave;
        posiciona(atual);
        if (k < 1) quadro = requestAnimationFrame(passo);
      };
      quadro = requestAnimationFrame(passo);
    },
    destroi() { cancelAnimationFrame(quadro); },
  };
}

/** Quanto do trajeto já andou, por estado do pedido. */
export function progressoDoStatus(status) {
  return ({
    criado: 0, aguardando_loja: 0, aguardando_receita: 0,
    em_separacao: 0.04, aguardando_cliente: 0.04, pronto: 0.08,
    em_rota: 0.62, entregue: 1, cancelado: 0,
  })[status] ?? 0;
}
