/* ============================================================
   MAPA

   Agora é mapa de verdade: telhas do OpenStreetMap, nas coordenadas
   reais da farmácia e do endereço de entrega. A versão anterior era um
   desenho vetorial — bonito, mas era sempre a mesma cidade imaginária,
   e quem conhece o próprio bairro percebia na hora.

   O trajeto é o caminho de rua de verdade: vem do OSRM, o mesmo motor de
   rota que o OpenStreetMap usa. A linha curva que existia antes cortava
   quarteirão, atravessava rio e passava por cima de prédio — e qualquer
   pessoa que conhece o bairro via que aquilo não era um caminho.

   O mapa desenha a curva primeiro e troca pela rota real quando ela
   chega: esperar o roteador para mostrar qualquer coisa deixaria a tela
   em branco no pior momento, que é logo depois de pagar.

   As telhas vêm de um servidor público (tile.openstreetmap.org), o que
   exige internet e crédito visível na tela — está no rodapé, como manda
   a licença.
   ============================================================ */

const TELHA = 256;
const FONTE = 'https://tile.openstreetmap.org';

/* ---------- Web Mercator: grau vira pixel ---------- */
const xDe = (lon, z) => ((lon + 180) / 360) * Math.pow(2, z);
const yDe = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
};

/** Distância em metros — serve para escolher o zoom e para mostrar "a 1,2 km". */
export function distancia(a, b) {
  const R = 6371000, r = (g) => (g * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** O maior zoom em que os dois pontos ainda cabem na tela, com folga. */
function zoomQueCabe(origem, destino, larg, alt) {
  for (let z = 17; z >= 11; z--) {
    const dx = Math.abs(xDe(destino.lng, z) - xDe(origem.lng, z)) * TELHA;
    const dy = Math.abs(yDe(destino.lat, z) - yDe(origem.lat, z)) * TELHA;
    if (dx < larg * 0.62 && dy < alt * 0.52) return z;
  }
  return 11;
}

/* ---------- a tela ---------- */

/**
 * Monta o mapa dentro de `container`.
 *
 * `origem` e `destino` são {lat, lng}. Sem coordenadas o mapa não
 * aparece: é melhor não mostrar mapa nenhum do que mostrar uma cidade
 * que não é a da pessoa.
 */
export function criaMapa(container, opcoes = {}) {
  const { progresso = 0, origem, destino, aproximado = true } = opcoes;
  if (!origem?.lat || !destino?.lat) {
    container.innerHTML = '<div class="mapa-sem-coord">Mapa indisponível para este endereço</div>';
    return { get progresso() { return 0; }, anima() {}, destroi() {} };
  }

  let larg = container.clientWidth || 380;
  let alt = container.clientHeight || 260;
  let z = zoomQueCabe(origem, destino, larg, alt);

  // o centro fica entre os dois pontos, puxado um pouco para cima:
  // a folha de informação cobre a parte de baixo da tela
  let cx = (xDe(origem.lng, z) + xDe(destino.lng, z)) / 2;
  let cy = (yDe(origem.lat, z) + yDe(destino.lat, z)) / 2 + (alt * 0.10) / TELHA;

  // pixel do ponto na tela, dado o centro
  const px = (p) => ({
    x: (xDe(p.lng, z) - cx) * TELHA + larg / 2,
    y: (yDe(p.lat, z) - cy) * TELHA + alt / 2,
  });
  const A = px(origem), B = px(destino);

  // curva suave entre os dois: reta pura parece erro de desenho,
  // e curva demais mente sobre a distancia
  const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
  const nx = -(B.y - A.y), ny = B.x - A.x;
  const comp = Math.hypot(nx, ny) || 1;
  const curva = Math.min(46, comp * 0.16);
  const ctrl = { x: mx + (nx / comp) * curva, y: my + (ny / comp) * curva };
  const ROTA = `M ${A.x.toFixed(1)} ${A.y.toFixed(1)} Q ${ctrl.x.toFixed(1)} ${ctrl.y.toFixed(1)} ${B.x.toFixed(1)} ${B.y.toFixed(1)}`;

  container.innerHTML = `
  <div class="mapa-palco"><div class="mapa-telhas">${telhas(cx, cy, z, larg, alt)}</div>
  <svg class="mapa-svg" width="${larg}" height="${alt}" viewBox="0 0 ${larg} ${alt}" aria-hidden="true">
    <defs>
      <filter id="sombraPino" x="-60%" y="-60%" width="220%" height="220%">
        <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#071F5E" flood-opacity=".34"/>
      </filter>
      <linearGradient id="gRota" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="#1138B4"/><stop offset="1" stop-color="#2E6BFF"/>
      </linearGradient>
    </defs>

    <path class="rota-halo" d="${ROTA}" fill="none" stroke="#fff" stroke-width="9"
          stroke-linecap="round" opacity=".9"/>
    <path class="rota-base" d="${ROTA}" fill="none" stroke="var(--mapa-rota-base)"
          stroke-width="5.5" stroke-linecap="round"/>
    <path class="rota" d="${ROTA}" fill="none" stroke="url(#gRota)"
          stroke-width="5.5" stroke-linecap="round"/>

    <g class="pino-origem" filter="url(#sombraPino)" transform="translate(${A.x} ${A.y})">
      <circle r="14" fill="#fff"/>
      <circle r="14" fill="none" stroke="var(--brand)" stroke-width="2"/>
      <g transform="scale(0.21) translate(-50 -50)" fill="none" stroke="var(--brand)"
         stroke-width="19" stroke-linecap="round">
        <path d="M53.5 28.5 C53.5 43.5 34 39.5 27.7 50.5"/>
        <path d="M46.5 71.5 C46.5 56.5 66 60.5 72.3 49.5"/>
      </g>
    </g>

    <g class="pino-destino" filter="url(#sombraPino)" transform="translate(${B.x} ${B.y})">
      <path d="M0 -26 c7.2 0 13 5.6 13 12.6 0 8.6 -13 20.4 -13 20.4 s-13 -11.8 -13 -20.4 C-13 -20.4 -7.2 -26 0 -26z"
            fill="var(--brand)"/>
      <circle cy="-13.4" r="4.6" fill="#fff"/>
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
  </svg></div>
  <div class="mapa-zoom">
    <button class="z-mais" aria-label="Aproximar">+</button>
    <button class="z-menos" aria-label="Afastar">−</button>
    <button class="z-centro" aria-label="Enquadrar o trajeto">⤢</button>
  </div>
  <div class="mapa-credito">
    <span class="trecho">calculando o trajeto…</span>
    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>
  </div>`;

  const svg = container.querySelector('svg');
  const rota = svg.querySelector('.rota');
  const base = svg.querySelector('.rota-base');
  const halo = svg.querySelector('.rota-halo');
  const moto = svg.querySelector('.moto');
  let total = rota.getTotalLength();
  rota.style.strokeDasharray = total;

  let atual = Math.max(0, Math.min(1, progresso));
  let quadro = null;
  // enquanto nao chega posicao de GPS, a moto anda por interpolacao;
  // quando chega, esta trava desliga a encenacao e manda o ponto real
  let real = false;

  function posiciona(t) {
    const p = rota.getPointAtLength(total * t);
    const q = rota.getPointAtLength(Math.min(total, total * t + 1.2));
    const ang = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
    moto.setAttribute('transform', `translate(${p.x} ${p.y})`);
    // a moto acompanha a curva, mas o glifo fica de pe: motoboy nao anda
    // de cabeca para baixo
    moto.querySelector('.moto-glifo')
      .setAttribute('transform', `scale(${Math.cos(ang * Math.PI / 180) < 0 ? -1 : 1} 1)`);
    rota.style.strokeDashoffset = total * (1 - t);
  }
  posiciona(atual);

  const enquadra = ligaGestos(container);

  // troca a curva pelo caminho de rua assim que o roteador responder
  let percurso = null;
  rotaDeRua(origem, destino).then((r) => {
    if (!r?.pontos?.length) return;
    percurso = r;
    const d = r.pontos.map((pt, i) => {
      const q = px(pt);
      return (i ? 'L ' : 'M ') + q.x.toFixed(1) + ' ' + q.y.toFixed(1);
    }).join(' ');
    for (const el of [halo, base, rota]) el.setAttribute('d', d);
    total = rota.getTotalLength();
    rota.style.strokeDasharray = total;
    posiciona(atual);
    const cr = container.querySelector('.mapa-credito .trecho');
    if (cr) {
      const km = (r.metros / 1000).toFixed(1).replace('.', ',');
      cr.textContent = `${km} km · ${Math.round(r.segundos / 60)} min de moto`;
    }
  }).catch(() => { /* sem roteador, a curva continua valendo */ });

  return {
    get progresso() { return atual; },
    get metros() { return percurso?.metros ?? Math.round(distancia(origem, destino)); },
    get rua() { return !!percurso; },
    /** Leva a moto ate `alvo` em `ms`, com a mesma curva do resto do app. */
    anima(alvo, ms = 1400) {
      if (real) return;
      cancelAnimationFrame(quadro);
      const de = atual, delta = Math.max(0, Math.min(1, alvo)) - de;
      if (Math.abs(delta) < 0.001) return;
      const t0 = performance.now();
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        atual = de + delta; return posiciona(atual);
      }
      const passo = (agora) => {
        const k = Math.min(1, (agora - t0) / ms);
        const suave = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        atual = de + delta * suave;
        posiciona(atual);
        if (k < 1) quadro = requestAnimationFrame(passo);
      };
      quadro = requestAnimationFrame(passo);
    },
    /** Volta o mapa ao enquadramento que mostra o trajeto inteiro. */
    enquadra,

    /**
     * A moto na posição REAL, vinda do GPS do entregador.
     *
     * Quando isto é chamado, o desenho para de fingir: a moto deixa de
     * andar por interpolação ao longo da linha e passa a ficar onde a
     * pessoa está. A rota continua sendo pintada até o ponto mais
     * próximo dela, para a linha andar junto sem mentir sobre o caminho.
     */
    poeMoto(p) {
      if (!p?.lat) return;
      real = true;
      const q = px(p);
      moto.setAttribute('transform', `translate(${q.x} ${q.y})`);
      moto.classList.add('viva');
      // acha o ponto da rota mais perto da moto: é até ali que ela andou
      let melhor = 0, menor = Infinity;
      for (let t = 0; t <= 1; t += 0.02) {
        const r = rota.getPointAtLength(total * t);
        const d = (r.x - q.x) ** 2 + (r.y - q.y) ** 2;
        if (d < menor) { menor = d; melhor = t; }
      }
      atual = melhor;
      rota.style.strokeDashoffset = total * (1 - atual);
    },
    get aoVivo() { return real; },
    destroi() { cancelAnimationFrame(quadro); },
  };
}

/**
 * As telhas que cobrem a tela.
 *
 * Uma a mais de cada lado: sem a folga, o canto aparece vazio enquanto a
 * imagem carrega, e mapa com buraco branco parece quebrado.
 */
function telhas(cx, cy, z, larg, alt) {
  const max = Math.pow(2, z);
  const x0 = Math.floor(cx - larg / 2 / TELHA) - 1;
  const y0 = Math.floor(cy - alt / 2 / TELHA) - 1;
  const nx = Math.ceil(larg / TELHA) + 3, ny = Math.ceil(alt / TELHA) + 3;
  let html = '';
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const tx = x0 + i, ty = y0 + j;
      if (ty < 0 || ty >= max) continue;
      const wrap = ((tx % max) + max) % max;   // o mundo da a volta na longitude
      const esq = (tx - cx) * TELHA + larg / 2;
      const topo = (ty - cy) * TELHA + alt / 2;
      html += `<img src="${FONTE}/${z}/${wrap}/${ty}.png" alt="" loading="eager" decoding="async"
        style="left:${esq.toFixed(1)}px;top:${topo.toFixed(1)}px">`;
    }
  }
  return html;
}

/** Quanto do trajeto ja andou, por estado do pedido. */
export function progressoDoStatus(status) {
  return ({
    criado: 0, aguardando_loja: 0, aguardando_receita: 0,
    em_separacao: 0.04, aguardando_cliente: 0.04, pronto: 0.08,
    em_rota: 0.62, entregue: 1, cancelado: 0,
  })[status] ?? 0;
}

/**
 * O caminho de rua, pelo OSRM — o mesmo motor de rota do OpenStreetMap.
 *
 * Duas decisões que valem explicação:
 *
 *   · o servidor é o público de demonstração, que tem limite de uso e
 *     não promete disponibilidade. Por isso nada aqui é obrigatório: se
 *     falhar, o mapa fica com a curva e o app continua funcionando. Em
 *     produção com volume, troca-se a URL por uma instância própria —
 *     é uma constante;
 *   · o resultado fica em memória por trajeto. Dois pedidos para o mesmo
 *     endereço não perguntam duas vezes, e reabrir o pedido não bate no
 *     servidor de novo.
 */
const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const guardado = new Map();

export async function rotaDeRua(origem, destino) {
  const chave = [origem.lat, origem.lng, destino.lat, destino.lng]
    .map((n) => n.toFixed(5)).join(',');
  if (guardado.has(chave)) return guardado.get(chave);

  const promessa = (async () => {
    const alvo = `${OSRM}/${origem.lng},${origem.lat};${destino.lng},${destino.lat}`
      + '?overview=full&geometries=geojson';
    const controle = new AbortController();
    // o mapa não pode ficar pendurado esperando rota: 6 segundos e desiste
    const corta = setTimeout(() => controle.abort(), 6000);
    try {
      const r = await fetch(alvo, { signal: controle.signal });
      const d = await r.json();
      const via = d?.routes?.[0];
      if (d.code !== 'Ok' || !via?.geometry?.coordinates?.length) return null;
      return {
        pontos: via.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
        metros: Math.round(via.distance),
        segundos: Math.round(via.duration),
      };
    } finally { clearTimeout(corta); }
  })().catch(() => null);

  guardado.set(chave, promessa);
  return promessa;
}

/**
 * Deixa o mapa na mão da pessoa: arrastar, pinçar e rolar para o zoom.
 *
 * O trajeto inteiro raramente cabe bem num retângulo de celular. Sem
 * poder mexer, quem quer conferir a esquina onde a moto está fica
 * olhando para um borrão — e "acompanhar a entrega" vira enfeite.
 *
 * Reimplementar o mapa a cada gesto seria lento e piscaria as telhas.
 * Então o gesto mexe só num transform CSS, e o mapa se redesenha de
 * verdade quando o dedo sai — que é quando as telhas na nova escala
 * fazem falta.
 */
function ligaGestos(container) {
  let escala = 1, dx = 0, dy = 0;
  let arrastando = false, x0 = 0, y0 = 0, base = 1, dist0 = 0;
  const palcoMapa = container.querySelector('.mapa-palco');
  if (!palcoMapa) return () => {};

  const aplica = () => {
    palcoMapa.style.transform = `translate(${dx}px, ${dy}px) scale(${escala})`;
  };
  // segura o mapa dentro de limites razoaveis: soltar o dedo com o mapa
  // fora da tela deixaria a pessoa olhando para o nada
  const limpa = () => {
    const folga = 260 * escala;
    dx = Math.max(-folga, Math.min(folga, dx));
    dy = Math.max(-folga, Math.min(folga, dy));
    palcoMapa.style.transition = 'transform .28s cubic-bezier(.32,.72,0,1)';
    aplica();
    container.classList.toggle('mexido', escala !== 1 || !!dx || !!dy);
    setTimeout(() => { palcoMapa.style.transition = ''; }, 300);
  };

  const zoomPor = (f) => {
    escala = Math.max(0.6, Math.min(6, escala * f));
    palcoMapa.style.transition = 'transform .22s cubic-bezier(.32,.72,0,1)';
    aplica();
    container.classList.add('mexido');
    setTimeout(() => { palcoMapa.style.transition = ''; }, 240);
  };
  const enquadra = () => {
    escala = 1; dx = 0; dy = 0;
    palcoMapa.style.transition = 'transform .34s cubic-bezier(.32,.72,0,1)';
    aplica();
    container.classList.remove('mexido');
    setTimeout(() => { palcoMapa.style.transition = ''; }, 360);
  };
  container.querySelector('.z-mais')?.addEventListener('click', (e) => { e.stopPropagation(); zoomPor(1.5); });
  container.querySelector('.z-menos')?.addEventListener('click', (e) => { e.stopPropagation(); zoomPor(1 / 1.5); });
  container.querySelector('.z-centro')?.addEventListener('click', (e) => { e.stopPropagation(); enquadra(); });

  const doisDedos = (e) => Math.hypot(
    e.touches[0].clientX - e.touches[1].clientX,
    e.touches[0].clientY - e.touches[1].clientY);

  container.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) { dist0 = doisDedos(e); base = escala; arrastando = false; }
    else if (e.touches.length === 1) {
      arrastando = true; x0 = e.touches[0].clientX - dx; y0 = e.touches[0].clientY - dy;
    }
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && dist0) {
      escala = Math.max(0.6, Math.min(6, base * (doisDedos(e) / dist0)));
      aplica();
    } else if (arrastando && e.touches.length === 1) {
      dx = e.touches[0].clientX - x0; dy = e.touches[0].clientY - y0;
      aplica();
    }
  }, { passive: true });

  container.addEventListener('touchend', (e) => {
    if (e.touches.length) return;
    arrastando = false; dist0 = 0;
    if (escala !== 1 || dx || dy) limpa();
  }, { passive: true });

  // no computador: roda do mouse dá zoom, arrastar com o botão move
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    escala = Math.max(0.6, Math.min(6, escala * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
    aplica();
    clearTimeout(container._parou);
    container._parou = setTimeout(limpa, 260);
  }, { passive: false });

  container.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    arrastando = true; x0 = e.clientX - dx; y0 = e.clientY - dy;
    container.setPointerCapture(e.pointerId);
    container.classList.add('arrastando');
  });
  container.addEventListener('pointermove', (e) => {
    if (!arrastando || e.pointerType === 'touch') return;
    dx = e.clientX - x0; dy = e.clientY - y0; aplica();
  });
  container.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch' || !arrastando) return;
    arrastando = false;
    container.classList.remove('arrastando');
    if (escala !== 1 || dx || dy) limpa();
  });

  return enquadra;
}
