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
/*
 * Telha do OpenStreetMap, escurecida na CAMADA — não em cada imagem.
 *
 * Aqui estava a causa do travamento: o filtro escuro era aplicado em
 * cada uma das 81 imagens (`.nav-telhas img { filter: ... }`). Como o
 * mapa gira, o navegador refazia 81 filtros a cada quadro.
 *
 * Aplicado no contêiner, o filtro roda uma vez sobre a camada já
 * composta, e o giro passa a ser só transform — que a GPU faz de graça.
 * Mesmo desenho, uma fração do custo.
 *
 * (Tentei telha escura pronta do CARTO, que seria melhor ainda: hoje
 * pede chave de API. Fica como troca de uma linha quando houver uma.)
 */
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

        <g class="seta-corpo" filter="url(#sombraSeta)">
          <path d="M38 17 L51 49 L38 42 Z" fill="url(#faceEscura)"/>
          <path d="M38 17 L25 49 L38 42 Z" fill="url(#faceClara)"/>
          <path d="M38 17 L38 42" stroke="#EAFBFF" stroke-width="1" opacity=".5"/>
        </g>
        </svg>
      </div>
    </div>`;

  const telhas = container.querySelector('.nav-telhas');
  const palco = container.querySelector('.nav-palco');
  const svg = container.querySelector('.nav-svg');
  const seta = container.querySelector('.nav-seta');
  const corpoSeta = container.querySelector('.seta-corpo');
  const rotaEl = svg.querySelector('.nav-rota');
  const sombraEl = svg.querySelector('.nav-rota-sombra');
  const andadoEl = svg.querySelector('.nav-andado');
  const paradasEl = svg.querySelector('.nav-paradas');

  let centro = null, giro = 0, pontos = [], paradas = [], seguindo = true;
  // o rumo da moto e o giro do mapa sao duas coisas: solto no norte o
  // mapa para de girar, mas a seta continua tendo para onde apontar
  let rumoSeta = 0;

  /**
   * O angulo mais perto, sem dar a volta.
   *
   * O rumo chega sempre entre 0 e 360, entao apontar para o norte era
   * pular de 359 para 1 — e um `transition` nao sabe que 359 e 1 sao
   * vizinhos: ele anima os 358 graus do caminho longo. Na moto isso e
   * o mapa inteiro rodopiando toda vez que a pessoa aponta para o
   * norte. Aqui o angulo vira continuo: pode passar de 360 e ficar
   * negativo, porque o que importa e a distancia ate o anterior.
   */
  const aproxima = (atual, alvo) =>
    atual + (((((alvo - atual) % 360) + 540) % 360) - 180);
  // o palco e maior que a tela (inset negativo) para o giro nunca mostrar
  // canto vazio -- entao a medida que vale e a DELE, nao a do container
  let larg = palco.clientWidth || 520, alt = palco.clientHeight || 720;

  const px = (p) => ({
    x: (xDe(p.lng, zoom) - xDe(centro.lng, zoom)) * TELHA + larg / 2,
    y: (yDe(p.lat, zoom) - yDe(centro.lat, zoom)) * TELHA + alt / 2,
  });

  /**
   * As telhas.
   *
   * O erro que deixava o mapa travado: isto reconstruía o innerHTML com
   * 81 <img> a CADA batida de GPS — uma vez por segundo. O navegador
   * jogava fora 81 imagens já decodificadas e pedia as mesmas de volta,
   * e o resultado era um mapa que engasgava a cada passo da moto.
   *
   * Agora a grade só é reconstruída quando o centro muda de telha. Entre
   * uma reconstrução e outra, a camada inteira anda com um translate —
   * que o navegador resolve na GPU, sem tocar em DOM.
   */
  // telha em dobro de resolucao onde a tela merece: o texto da rua fica
  // legivel em vez de borrado, e o custo e o mesmo numero de imagens
  const retina = (window.devicePixelRatio || 1) > 1.4 ? '@2x' : '';
  let telhaAtual = null;
  // o centro em que o path da rota foi montado: enquanto ele valer, a
  // rota so desliza junto com as telhas
  let baseRota = null;
  function pintaTelhas() {
    if (!centro) return;
    const cx = xDe(centro.lng, zoom), cy = yDe(centro.lat, zoom);
    const max = Math.pow(2, zoom);
    // o mapa gira: a diagonal e o que precisa estar coberto, nao a largura.
    // Teto de 4 porque tela grande em zoom alto pediria 120 telhas de uma
    // vez, e o servidor publico do OpenStreetMap corta -- o mapa fica preto
    const raio = Math.min(4, Math.ceil(Math.hypot(larg, alt) / TELHA / 2) + 1);
    const bx = Math.floor(cx), by = Math.floor(cy);

    if (!telhaAtual || telhaAtual.x !== bx || telhaAtual.y !== by) {
      telhaAtual = { x: bx, y: by, cx: bx, cy: by };
      let html = '';
      for (let i = -raio; i <= raio; i++) {
        for (let j = -raio; j <= raio; j++) {
          const tx = bx + i, ty = by + j;
          if (ty < 0 || ty >= max) continue;
          const wrap = ((tx % max) + max) % max;
          html += `<img src="${FONTE}/${zoom}/${wrap}/${ty}.png" alt="" decoding="async"
            style="left:${(i * TELHA).toFixed(0)}px;top:${(j * TELHA).toFixed(0)}px">`;
        }
      }
      telhas.innerHTML = html;
    }
    // o deslocamento fino fica no transform da camada: nada de DOM
    telhas.style.transform =
      `translate3d(${((telhaAtual.cx - cx) * TELHA + larg / 2).toFixed(1)}px,`
      + `${((telhaAtual.cy - cy) * TELHA + alt / 2).toFixed(1)}px,0)`;
  }

  /**
   * A rota.
   *
   * Recalcular o path a cada batida de GPS era refazer conta para 100+
   * pontos uma vez por segundo. Como a rota não muda enquanto a pessoa
   * anda em cima dela, o path é montado uma vez em coordenada de telha e
   * só o deslocamento entra depois — mesma ideia das telhas.
   */
  function desenhaRota(andadoAte = 0) {
    if (!pontos.length || !centro) return;
    const d = pontos.map((p, i) => {
      const q = px(p);
      return (i ? 'L ' : 'M ') + q.x.toFixed(1) + ' ' + q.y.toFixed(1);
    }).join(' ');
    rotaEl.setAttribute('d', d);
    sombraEl.setAttribute('d', d);
    baseRota = { cx: xDe(centro.lng, zoom), cy: yDe(centro.lat, zoom) };
    svg.style.transform = 'translate3d(0,0,0)';
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

  /**
   * Onde o palco fica, e para onde a seta aponta.
   *
   * Duas coisas estavam erradas aqui, e as duas apareciam como a mesma
   * queixa: a seta saia do lugar.
   *
   * A primeira: a seta era irma do palco, nao filha. Ficava pregada em
   * 54% da tela enquanto as telhas e a rota andavam no transform do
   * palco — arrastar ou dar zoom levava o mapa embora e deixava a seta
   * para tras, marcando um ponto que nao era o da moto. Agora ela mora
   * DENTRO do palco, no centro dele, que e exatamente onde `px(centro)`
   * cai. Andam no mesmo transform: nao tem como se separarem.
   *
   * A segunda: o palco girava em volta de 50%/62%, e o ponto da moto e o
   * centro, 50%/50%. Girar em volta de um ponto que nao e o da moto poe a
   * moto numa orbita de uns 150px — a cada tremida da bussola a posicao
   * real passeava pela tela. Com a origem no centro, girar prende a moto,
   * e o mundo e que vira em volta dela, como tem que ser.
   *
   * Girar, quem gira e o corpo da seta, em `rumo - giro`:
   *   · seguindo a moto, giro == rumo, a conta da zero e a seta aponta
   *     para cima — porque quem virou foi o mapa;
   *   · solto no norte, giro == 0, e a seta aponta para o rumo de verdade.
   *
   * O halo e a sombra do chao ficam fora do giro (contra-giram +giro):
   * sombra que passeia em volta do objeto entrega que aquilo e um desenho.
   */
  function aplicaPalco() {
    palco.style.transform =
      'translate(var(--gx,0px), var(--gy,0px)) scale(var(--gz,1))'
      + ` translateY(12%) rotate(${(-giro).toFixed(1)}deg)`;
    seta.style.setProperty('--anti', `${giro.toFixed(1)}deg`);
    corpoSeta.setAttribute('transform',
      `rotate(${(rumoSeta - giro).toFixed(1)} 38 38)`);
  }
  return {
    /** Move o mapa para a posicao nova, girando na direcao do movimento. */
    vai(pos, { rumoGraus = null, andadoAte = 0 } = {}) {
      centro = pos;
      if (rumoGraus !== null && !Number.isNaN(rumoGraus)) {
        rumoSeta = aproxima(rumoSeta, rumoGraus);
        if (seguindo) giro = aproxima(giro, rumoGraus);
      }
      larg = palco.clientWidth || larg;
      alt = palco.clientHeight || alt;
      svg.setAttribute('width', larg);
      svg.setAttribute('height', alt);
      svg.setAttribute('viewBox', `0 0 ${larg} ${alt}`);
      // o piloto fica no terco de baixo: o que importa e o que vem pela frente
      aplicaPalco();
      pintaTelhas();
      // a rota acompanha o mesmo deslocamento das telhas, em vez de ser
      // recalculada ponto a ponto a cada segundo
      const cx = xDe(centro.lng, zoom), cy = yDe(centro.lat, zoom);
      if (!baseRota) desenhaRota(andadoAte);
      else {
        svg.style.transform =
          `translate3d(${((baseRota.cx - cx) * TELHA).toFixed(1)}px,`
          + `${((baseRota.cy - cy) * TELHA).toFixed(1)}px,0)`;
      }
    },
    poeRota(lista, listaParadas = []) {
      pontos = lista ?? []; paradas = listaParadas; baseRota = null; desenhaRota();
    },
    gestos: ligaGestosNav(container, palco,
      () => container.classList.add('mexido'),
      () => container.classList.remove('mexido')),
    /** Solta o giro: o mapa volta a apontar para o norte. */
    soltaNorte() {
      // o norte mais perto, nao o zero: de 715 graus, zero sao duas
      // voltas de rodopio para chegar na mesma direcao
      seguindo = false; giro = Math.round(giro / 360) * 360; aplicaPalco();
    },
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

/**
 * Gestos no mapa de navegação.
 *
 * Quem dirige também precisa conferir o quarteirão seguinte sem sair da
 * rota. Aqui o gesto mexe num segundo transform, por fora do que a
 * navegação usa para girar e seguir — assim dá para afastar, olhar e
 * largar, e o mapa volta a seguir a moto sozinho depois de três
 * segundos parado. Navegador que fica preso no zoom que você deu é
 * pior do que navegador sem zoom.
 */
function ligaGestosNav(container, palco, aoMexer, aoSoltar) {
  let escala = 1, dx = 0, dy = 0, base = 1, dist0 = 0;
  let arrastando = false, x0 = 0, y0 = 0, volta = null;

  const aplica = () => {
    palco.style.setProperty('--gx', `${dx}px`);
    palco.style.setProperty('--gy', `${dy}px`);
    palco.style.setProperty('--gz', escala);
    // o inverso vai pronto: `calc(1 / var(--gz))` so computa com o --gz
    // registrado por @property, e onde nao registra o transform inteiro
    // cai fora — a seta iria parar no canto da tela. Uma divisao aqui
    // custa nada e funciona em tudo
    palco.style.setProperty('--gzi', 1 / escala);
  };
  const mexeu = () => {
    clearTimeout(volta);
    aoMexer();
    // três segundos parado e o mapa volta a acompanhar a moto sozinho
    volta = setTimeout(() => {
      escala = 1; dx = 0; dy = 0;
      palco.style.transition = 'transform .5s cubic-bezier(.32,.72,0,1)';
      aplica();
      aoSoltar();
      setTimeout(() => { palco.style.transition = ''; }, 520);
    }, 3000);
  };

  const doisDedos = (e) => Math.hypot(
    e.touches[0].clientX - e.touches[1].clientX,
    e.touches[0].clientY - e.touches[1].clientY);

  container.addEventListener('touchstart', (e) => {
    clearTimeout(volta);
    if (e.touches.length === 2) { dist0 = doisDedos(e); base = escala; arrastando = false; }
    else { arrastando = true; x0 = e.touches[0].clientX - dx; y0 = e.touches[0].clientY - dy; }
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && dist0) {
      escala = Math.max(0.5, Math.min(5, base * (doisDedos(e) / dist0)));
    } else if (arrastando) {
      dx = e.touches[0].clientX - x0; dy = e.touches[0].clientY - y0;
    }
    aplica(); aoMexer();
  }, { passive: true });

  container.addEventListener('touchend', (e) => {
    if (e.touches.length) return;
    arrastando = false; dist0 = 0;
    if (escala !== 1 || dx || dy) mexeu();
  }, { passive: true });

  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    escala = Math.max(0.5, Math.min(5, escala * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    aplica(); mexeu();
  }, { passive: false });

  container.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    clearTimeout(volta);
    arrastando = true; x0 = e.clientX - dx; y0 = e.clientY - dy;
    container.setPointerCapture(e.pointerId);
  });
  container.addEventListener('pointermove', (e) => {
    if (!arrastando || e.pointerType === 'touch') return;
    dx = e.clientX - x0; dy = e.clientY - y0; aplica(); aoMexer();
  });
  container.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch' || !arrastando) return;
    arrastando = false;
    if (escala !== 1 || dx || dy) mexeu();
  });

  return {
    maisPerto() { escala = Math.min(5, escala * 1.5); aplica(); mexeu(); },
    maisLonge() { escala = Math.max(0.5, escala / 1.5); aplica(); mexeu(); },
    reenquadra() {
      clearTimeout(volta);
      escala = 1; dx = 0; dy = 0;
      palco.style.transition = 'transform .4s cubic-bezier(.32,.72,0,1)';
      aplica(); aoSoltar();
      setTimeout(() => { palco.style.transition = ''; }, 420);
    },
    get mexido() { return escala !== 1 || !!dx || !!dy; },
  };
}

/* ============================================================
   BÚSSOLA

   O rumo do GPS só existe em movimento: parado no semáforo, ele fica
   girando sozinho ou some. Quem está com o celular no suporte quer que o
   mapa acompanhe para onde a MOTO está apontada — e isso é a bússola do
   aparelho, não o GPS.

   Então as duas fontes se dividem o trabalho:

     · andando (acima de ~5 km/h): manda o rumo do GPS, que é estável e
       segue a via;
     · parado ou devagar: manda a bússola, que é a única que sabe para
       onde o guidão está virado.

   No iPhone a leitura vem em `webkitCompassHeading` e já é absoluta. No
   Android vem em `alpha`, que conta ao contrário e precisa do evento
   absoluto para valer como norte verdadeiro.
   ============================================================ */

let bussolaAtual = null;
let bussolaLigada = false;

export function rumoDaBussola() { return bussolaAtual; }

export async function ligaBussola() {
  if (bussolaLigada) return true;

  // no iPhone a permissão tem que ser pedida dentro de um toque
  const pedir = window.DeviceOrientationEvent?.requestPermission;
  if (typeof pedir === 'function') {
    try {
      if (await DeviceOrientationEvent.requestPermission() !== 'granted') return false;
    } catch { return false; }
  }

  const leitura = (e) => {
    if (typeof e.webkitCompassHeading === 'number') {
      bussolaAtual = e.webkitCompassHeading;           // iOS: já é o norte
    } else if (e.absolute && typeof e.alpha === 'number') {
      bussolaAtual = (360 - e.alpha) % 360;            // Android: conta ao contrário
    }
  };
  window.addEventListener('deviceorientationabsolute', leitura, { passive: true });
  window.addEventListener('deviceorientation', leitura, { passive: true });
  bussolaLigada = true;
  return true;
}

/**
 * O rumo que vale agora.
 *
 * Suavizado: bússola de celular treme uns graus o tempo todo, e mapa que
 * treme junto dá enjoo. O filtro puxa 25% na direção da leitura nova a
 * cada quadro, e trata a volta pelo 360 para não girar o caminho longo.
 */
let rumoSuave = null;
export function rumoParaOMapa(rumoGps, velocidade) {
  const bruto = (velocidade > 1.5 && rumoGps !== null && !Number.isNaN(rumoGps))
    ? rumoGps
    : (bussolaAtual ?? rumoGps);
  if (bruto === null || bruto === undefined || Number.isNaN(bruto)) return rumoSuave ?? 0;
  if (rumoSuave === null) { rumoSuave = bruto; return rumoSuave; }

  let delta = ((bruto - rumoSuave + 540) % 360) - 180;
  rumoSuave = (rumoSuave + delta * 0.25 + 360) % 360;
  return rumoSuave;
}
