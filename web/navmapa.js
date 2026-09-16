/* ============================================================
   MAPA DE NAVEGAÇÃO

   O mapa do cliente serve para acompanhar; este serve para **não se
   perder**. São problemas diferentes, e é por isso que ele é outro
   arquivo em vez de uma opção do primeiro:

     · escuro, porque quem dirige olha para ele de dia no sol e de noite
       no escuro, e branco à noite cega;
     · orientado pelo rumo da moto, não pelo norte — quem está em cima da
       moto pensa em "vira à direita", não em "vire para nordeste";
     · a próxima manobra em cima de tudo, em texto grande, porque é a
       única coisa que importa nos próximos 200 metros;
     · o piloto no terço de baixo da tela, não no centro: o que interessa
       é o que vem pela frente.

   As telhas continuam sendo do OpenStreetMap, filtradas para escuro no
   próprio CSS — assim não dependemos de um segundo servidor de telha só
   para ter tema noturno.
   ============================================================ */

const TELHA = 256;
const FONTE = 'https://tile.openstreetmap.org';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

const xDe = (lon, z) => ((lon + 180) / 360) * Math.pow(2, z);
const yDe = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
};

export function metros(a, b) {
  const R = 6371000, r = (g) => (g * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rumo de A para B, em graus. É ele que gira o mapa. */
export function rumo(a, b) {
  const r = (g) => (g * Math.PI) / 180;
  const y = Math.sin(r(b.lng - a.lng)) * Math.cos(r(b.lat));
  const x = Math.cos(r(a.lat)) * Math.sin(r(b.lat))
    - Math.sin(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lng - a.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export const formataDistancia = (m) => (m < 1000
  ? `${Math.round(m / 10) * 10} m`
  : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

export const formataTempo = (s) => (s < 60
  ? 'menos de 1 min'
  : s < 3600 ? `${Math.round(s / 60)} min`
  : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);

/* ---------- traducao das manobras do OSRM ---------- */

/**
 * O OSRM devolve manobra em ingles e em vocabulario de roteirista.
 * Aqui vira o que se fala em cima de uma moto.
 */
const MANOBRA = {
  'turn-left': ['Vire à esquerda', 'esq'],
  'turn-right': ['Vire à direita', 'dir'],
  'turn-sharp left': ['Curva fechada à esquerda', 'esq'],
  'turn-sharp right': ['Curva fechada à direita', 'dir'],
  'turn-slight left': ['Mantenha-se à esquerda', 'esq-leve'],
  'turn-slight right': ['Mantenha-se à direita', 'dir-leve'],
  'turn-straight': ['Siga em frente', 'reto'],
  'depart': ['Siga', 'reto'],
  'arrive': ['Chegou', 'destino'],
  'merge': ['Entre na via', 'dir-leve'],
  'roundabout': ['Na rotatória', 'rotatoria'],
  'rotary': ['Na rotatória', 'rotatoria'],
  'fork-left': ['Pegue a via da esquerda', 'esq-leve'],
  'fork-right': ['Pegue a via da direita', 'dir-leve'],
  'end of road-left': ['No fim da rua, à esquerda', 'esq'],
  'end of road-right': ['No fim da rua, à direita', 'dir'],
  'continue': ['Continue', 'reto'],
  'new name': ['Siga', 'reto'],
};

function traduz(passo) {
  const m = passo.maneuver ?? {};
  const chave = `${m.type}-${m.modifier ?? 'straight'}`;
  const achado = MANOBRA[chave] ?? MANOBRA[m.type] ?? ['Siga', 'reto'];
  const rua = passo.name?.trim();
  let texto = achado[0];
  if (m.type === 'roundabout' && m.exit) texto = `Na rotatória, ${m.exit}ª saída`;
  return {
    texto, icone: achado[1],
    rua: rua || null,
    metros: Math.round(passo.distance ?? 0),
    segundos: Math.round(passo.duration ?? 0),
    em: m.location ? { lat: m.location[1], lng: m.location[0] } : null,
  };
}

/**
 * A rota com as manobras.
 *
 * `steps=true` é o que separa "uma linha no mapa" de "navegação": sem os
 * passos não dá para dizer em qual esquina virar, e o entregador volta a
 * depender de conhecer o bairro de cor.
 */
export async function rotaNavegavel(de, para) {
  const alvo = `${OSRM}/${de.lng},${de.lat};${para.lng},${para.lat}`
    + '?overview=full&geometries=geojson&steps=true&annotations=false';
  const controle = new AbortController();
  const corta = setTimeout(() => controle.abort(), 8000);
  try {
    const d = await fetch(alvo, { signal: controle.signal }).then((r) => r.json());
    const via = d?.routes?.[0];
    if (d.code !== 'Ok' || !via) return null;
    const passos = (via.legs ?? []).flatMap((l) => l.steps ?? []).map(traduz);
    return {
      pontos: via.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      metros: Math.round(via.distance),
      segundos: Math.round(via.duration),
      passos,
    };
  } catch { return null; } finally { clearTimeout(corta); }
}

/**
 * A melhor ordem para entregar várias.
 *
 * É o problema do caixeiro viajante, e com 8 paradas a força bruta já não
 * cabe. O vizinho mais próximo resolve em milissegundos e erra pouco na
 * escala real de uma farmácia de bairro — que são 3 a 6 entregas por
 * corrida. Guardar o ótimo teórico não vale o tempo de espera na tela.
 */
export function melhorOrdem(partida, paradas) {
  const restantes = paradas.filter((p) => p.lat && p.lng);
  const ordem = [];
  let aqui = partida;
  while (restantes.length) {
    let melhor = 0, menor = Infinity;
    restantes.forEach((p, i) => {
      const d = metros(aqui, p);
      // entrega em mãos e cadeia fria sobem na fila: remédio refrigerado
      // esquenta na bolsa, e quem espera receita não pode ficar por último
      const peso = d * (p.exige_termica ? 0.55 : p.exige_maos ? 0.8 : 1);
      if (peso < menor) { menor = peso; melhor = i; }
    });
    const escolhida = restantes.splice(melhor, 1)[0];
    ordem.push(escolhida);
    aqui = escolhida;
  }
  return ordem;
}

/* ---------- o mapa de navegacao ---------- */

/**
 * Desenha e conduz o mapa escuro do entregador.
 *
 * Diferente do mapa do cliente, este e vivo: recebe posicao a cada
 * batida de GPS e reposiciona telha, rota e seta sem redesenhar o HTML.
 * Redesenhar a cada segundo piscaria a tela inteira em cima de uma moto.
 */
export function criaNavegacao(container, { zoom = 17 } = {}) {
  container.innerHTML = `
    <div class="nav-palco">
      <div class="nav-telhas"></div>
      <svg class="nav-svg" aria-hidden="true">
        <defs>
          <linearGradient id="gNav" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stop-color="#2E6BFF"/><stop offset="1" stop-color="#63E6FF"/>
          </linearGradient>
          <filter id="brilhoRota" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="5" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <path class="nav-rota-sombra" fill="none" stroke="#04204A" stroke-width="16"
              stroke-linecap="round" stroke-linejoin="round"/>
        <path class="nav-rota" fill="none" stroke="url(#gNav)" stroke-width="10"
              stroke-linecap="round" stroke-linejoin="round" filter="url(#brilhoRota)"/>
        <path class="nav-andado" fill="none" stroke="#2A3550" stroke-width="10"
              stroke-linecap="round" stroke-linejoin="round"/>
        <g class="nav-paradas"></g>
      </svg>
    </div>
    <div class="nav-seta">
      <svg viewBox="0 0 76 76" aria-hidden="true">
        <defs>
          <radialGradient id="halo" cx="50%" cy="50%" r="50%">
            <stop offset="55%" stop-color="#2E6BFF" stop-opacity=".30"/>
            <stop offset="100%" stop-color="#2E6BFF" stop-opacity="0"/>
          </radialGradient>
          <!-- as duas faces da seta: a da esquerda pega a luz, a da
               direita fica na sombra. É só isso que faz um triângulo
               plano virar um volume -->
          <linearGradient id="faceClara" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#BFF4FF"/><stop offset="1" stop-color="#63E6FF"/>
          </linearGradient>
          <linearGradient id="faceEscura" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#2E8FD6"/><stop offset="1" stop-color="#1B5FA8"/>
          </linearGradient>
          <filter id="sombraSeta" x="-60%" y="-60%" width="220%" height="220%">
            <feDropShadow dx="0" dy="3" stdDeviation="3.4" flood-color="#04101F" flood-opacity=".85"/>
          </filter>
        </defs>

        <circle cx="38" cy="38" r="36" fill="url(#halo)"/>
        <!-- a base elíptica é a sombra projetada no chão: sem ela a seta
             parece adesivo colado na tela, não objeto sobre o mapa -->
        <ellipse cx="38" cy="52" rx="15" ry="5" fill="#04101F" opacity=".45"/>
        <circle cx="38" cy="38" r="21" fill="#0B1220" opacity=".9"/>
        <circle cx="38" cy="38" r="21" fill="none" stroke="#2E6BFF" stroke-width="1.6" opacity=".55"/>

        <g filter="url(#sombraSeta)">
          <path d="M38 17 L51 49 L38 42 Z" fill="url(#faceEscura)"/>
          <path d="M38 17 L25 49 L38 42 Z" fill="url(#faceClara)"/>
          <path d="M38 17 L38 42" stroke="#EAFBFF" stroke-width="1" opacity=".5"/>
        </g>
      </svg>
    </div>`;

  const telhas = container.querySelector('.nav-telhas');
  const palco = container.querySelector('.nav-palco');
  const svg = container.querySelector('.nav-svg');
  const rotaEl = svg.querySelector('.nav-rota');
  const sombraEl = svg.querySelector('.nav-rota-sombra');
  const andadoEl = svg.querySelector('.nav-andado');
  const paradasEl = svg.querySelector('.nav-paradas');

  let centro = null, giro = 0, pontos = [], paradas = [], seguindo = true;
  // o palco e maior que a tela (inset negativo) para o giro nunca mostrar
  // canto vazio -- entao a medida que vale e a DELE, nao a do container
  let larg = palco.clientWidth || 520, alt = palco.clientHeight || 720;

  const px = (p) => ({
    x: (xDe(p.lng, zoom) - xDe(centro.lng, zoom)) * TELHA + larg / 2,
    y: (yDe(p.lat, zoom) - yDe(centro.lat, zoom)) * TELHA + alt / 2,
  });

  /** As telhas ao redor do centro, com folga para o giro nao mostrar vazio. */
  function pintaTelhas() {
    if (!centro) return;
    const cx = xDe(centro.lng, zoom), cy = yDe(centro.lat, zoom);
    const max = Math.pow(2, zoom);
    // o mapa gira: a diagonal e o que precisa estar coberto, nao a largura
    // teto de 4: sem ele, tela grande em zoom alto pede 120 telhas de uma
    // vez, e o servidor publico do OpenStreetMap corta -- o mapa fica preto
    const raio = Math.min(4, Math.ceil(Math.hypot(larg, alt) / TELHA / 2) + 1);
    const x0 = Math.floor(cx) - raio, y0 = Math.floor(cy) - raio;
    let html = '';
    for (let i = 0; i <= raio * 2; i++) {
      for (let j = 0; j <= raio * 2; j++) {
        const tx = x0 + i, ty = y0 + j;
        if (ty < 0 || ty >= max) continue;
        const wrap = ((tx % max) + max) % max;
        html += `<img src="${FONTE}/${zoom}/${wrap}/${ty}.png" alt="" decoding="async"
          style="left:${((tx - cx) * TELHA + larg / 2).toFixed(1)}px;
                 top:${((ty - cy) * TELHA + alt / 2).toFixed(1)}px">`;
      }
    }
    telhas.innerHTML = html;
  }

  function desenhaRota(andadoAte = 0) {
    if (!pontos.length || !centro) return;
    const d = pontos.map((p, i) => {
      const q = px(p);
      return (i ? 'L ' : 'M ') + q.x.toFixed(1) + ' ' + q.y.toFixed(1);
    }).join(' ');
    rotaEl.setAttribute('d', d);
    sombraEl.setAttribute('d', d);
    if (andadoAte > 0) {
      const ate = pontos.slice(0, Math.max(2, andadoAte)).map((p, i) => {
        const q = px(p);
        return (i ? 'L ' : 'M ') + q.x.toFixed(1) + ' ' + q.y.toFixed(1);
      }).join(' ');
      andadoEl.setAttribute('d', ate);
    } else andadoEl.removeAttribute('d');

    paradasEl.innerHTML = paradas.map((p, i) => {
      const q = px(p);
      return `<g transform="translate(${q.x.toFixed(1)} ${q.y.toFixed(1)}) rotate(${-giro})">
        <circle r="15" fill="#0B1220" stroke="#63E6FF" stroke-width="2.5"/>
        <text y="5" text-anchor="middle" fill="#63E6FF"
              font-family="var(--mono)" font-size="14" font-weight="700">${i + 1}</text>
      </g>`;
    }).join('');
  }

  return {
    /** Move o mapa para a posicao nova, girando na direcao do movimento. */
    vai(pos, { rumoGraus = null, andadoAte = 0 } = {}) {
      centro = pos;
      if (seguindo && rumoGraus !== null && !Number.isNaN(rumoGraus)) giro = rumoGraus;
      larg = palco.clientWidth || larg;
      alt = palco.clientHeight || alt;
      svg.setAttribute('width', larg);
      svg.setAttribute('height', alt);
      svg.setAttribute('viewBox', `0 0 ${larg} ${alt}`);
      // o piloto fica no terco de baixo: o que importa e o que vem pela frente
      palco.style.transform = `translateY(12%) rotate(${-giro}deg)`;
      pintaTelhas();
      desenhaRota(andadoAte);
    },
    poeRota(lista, listaParadas = []) { pontos = lista ?? []; paradas = listaParadas; desenhaRota(); },
    /** Solta o giro: o mapa volta a apontar para o norte. */
    soltaNorte() { seguindo = false; giro = 0; palco.style.transform = 'translateY(12%)'; },
    voltaASeguir() { seguindo = true; },
    get seguindo() { return seguindo; },
  };
}

/* ============================================================
   VOZ

   O navegador já traz síntese de fala (`speechSynthesis`) — não precisa
   de biblioteca nem de servidor. A voz vem do sistema: no Android é a do
   Google, no iPhone é a da Siri, e em português do Brasil as duas soam
   bem.

   Duas regras que fazem diferença em cima de uma moto:

     · falar CEDO. "Vire à direita" dito em cima da esquina é inútil;
       o aviso sai a 300 m, de novo a 80 m, e a confirmação na hora;
     · nunca repetir a mesma frase. Navegador que fica repetindo vira
       ruído, e ruído a pessoa desliga — perdendo também o aviso que
       importava.
   ============================================================ */

const VOZ = {
  ligada: localStorage.getItem('sm_voz') !== '0',
  escolhida: null,
  dito: new Set(),
};

/**
 * Escolhe a voz.
 *
 * Prefere feminina em português do Brasil, que é a convenção dos
 * navegadores de rua no país e a que as pessoas esperam ouvir. A lista
 * chega assíncrona no Chrome, daí o evento.
 */
function escolheVoz() {
  const vozes = speechSynthesis.getVoices();
  if (!vozes.length) return null;
  const br = vozes.filter((v) => /pt[-_]?BR/i.test(v.lang));
  const fem = br.find((v) => /female|feminin|luciana|maria|francisca|vit[óo]ria|camila|fernanda/i.test(v.name));
  VOZ.escolhida = fem ?? br[0] ?? vozes.find((v) => /^pt/i.test(v.lang)) ?? null;
  return VOZ.escolhida;
}
if ('speechSynthesis' in window) {
  escolheVoz();
  speechSynthesis.addEventListener('voiceschanged', escolheVoz);
}

export function falaLigada() { return VOZ.ligada; }

export function alternaVoz() {
  VOZ.ligada = !VOZ.ligada;
  localStorage.setItem('sm_voz', VOZ.ligada ? '1' : '0');
  if (!VOZ.ligada) speechSynthesis.cancel();
  else fala('Voz ligada', { forcar: true });
  return VOZ.ligada;
}

/** Diz uma frase. `chave` evita repetir a mesma instrução. */
export function fala(texto, { chave = null, forcar = false } = {}) {
  if (!VOZ.ligada || !('speechSynthesis' in window)) return;
  if (chave && VOZ.dito.has(chave) && !forcar) return;
  if (chave) VOZ.dito.add(chave);

  const f = new SpeechSynthesisUtterance(texto);
  f.lang = 'pt-BR';
  if (VOZ.escolhida) f.voice = VOZ.escolhida;
  // um pouco mais devagar que o padrão: quem está com capacete e vento
  // perde sílaba, e instrução pela metade é pior que instrução nenhuma
  f.rate = 0.98;
  f.pitch = 1.02;
  f.volume = 1;
  speechSynthesis.cancel();   // a instrução nova sempre manda mais que a velha
  speechSynthesis.speak(f);
}

export function esqueceFalas() { VOZ.dito.clear(); }

/**
 * A frase da manobra, no tom de quem fala, não de quem escreve.
 *
 * "Em duzentos metros, vire à direita na Rua Sena Madureira" — a
 * distância primeiro, porque é ela que diz se a pessoa precisa agir
 * agora ou só ficar sabendo.
 */
export function fraseDaManobra(passo, distancia) {
  const rua = passo.rua ? ` na ${passo.rua}` : '';
  if (passo.icone === 'destino') return 'Você chegou ao destino.';
  if (distancia > 500) return `Siga por ${Math.round(distancia / 100) * 100} metros.`;
  if (distancia > 120) {
    return `Em ${Math.round(distancia / 50) * 50} metros, ${minuscula(passo.texto)}${rua}.`;
  }
  return `${passo.texto}${rua}.`;
}

const minuscula = (t) => t.charAt(0).toLowerCase() + t.slice(1);
