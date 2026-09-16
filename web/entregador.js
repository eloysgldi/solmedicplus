import { criaNavegacao, rotaNavegavel, melhorOrdem, metros, rumo,
         formataDistancia, formataTempo, fala, falaLigada, alternaVoz,
         esqueceFalas, fraseDaManobra } from './navmapa.js';

/**
 * ============================================================
 * SOLMEDIC+ ENTREGAS — o app de quem leva
 *
 * Feito para ser usado com uma mão, na rua, com sol na tela e pressa.
 * Três regras que valeram mais que qualquer decisão estética:
 *
 *   1. Um botão grande por vez. A tela nunca pergunta duas coisas.
 *   2. Nada de cor clara em área grande: o mapa é escuro e o resto
 *      acompanha, porque branco de dia vira espelho no capacete.
 *   3. O endereço vem antes do nome do cliente. Quem está dirigindo
 *      procura a rua, não a pessoa.
 * ============================================================
 */

const API = location.origin;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const brl = (c) => 'R$ ' + ((c ?? 0) / 100).toFixed(2).replace('.', ',');

const S = {
  token: localStorage.getItem('sm_token'),
  eu: null, fila: { minhas: [], disponiveis: [] }, loja: null,
  pos: null, rumoAtual: 0, vigia: null,
  rota: null, passoAtual: 0, navegando: null, mapa: null,
  erro: null, tela: 'fila', ocupado: false,
};

async function api(metodo, caminho, corpo) {
  const res = await fetch(API + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json',
               ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(d.mensagem || 'Falhou'), { code: d.erro });
  return d;
}

const vibra = (ms) => { try { navigator.vibrate?.(ms); } catch {} };

function aviso(texto, ruim) {
  const t = document.createElement('div');
  t.className = 'torrada' + (ruim ? ' ruim' : '');
  t.textContent = texto;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('sai'), 2600);
  setTimeout(() => t.remove(), 3100);
}

/* ============ GPS ============ */

/**
 * Liga a transmissao de posicao.
 *
 * `watchPosition` em vez de perguntar de tempos em tempos: o navegador
 * avisa quando a posicao muda de verdade, o que gasta menos bateria do
 * que acordar o GPS a cada 15 segundos. E bateria, para quem passa o dia
 * na rua com o celular no suporte, e requisito de produto.
 *
 * O envio e represado: o GPS entrega ponto varias vezes por segundo, e
 * mandar tudo isso encheria a rede e o banco sem melhorar nada. Uma
 * batida a cada 8 segundos, ou quando andou mais de 25 metros.
 */
function ligaGps() {
  if (!navigator.geolocation) return aviso('Este aparelho não tem GPS', true);
  if (!window.isSecureContext) {
    return aviso('A localização exige conexão segura (https)', true);
  }
  if (S.vigia !== null) return;

  let ultimoEnvio = 0, ultimoPonto = null;
  S.vigia = navigator.geolocation.watchPosition((p) => {
    const nova = { lat: p.coords.latitude, lng: p.coords.longitude };
    const antes = S.pos;
    S.pos = nova;
    // o rumo do GPS so e confiavel em movimento; parado ele gira sozinho
    if (p.coords.heading !== null && p.coords.speed > 1.2) S.rumoAtual = p.coords.heading;
    else if (antes && metros(antes, nova) > 6) S.rumoAtual = rumo(antes, nova);

    desenhaMapa();
    atualizaManobra();

    const agora = Date.now();
    const andou = ultimoPonto ? metros(ultimoPonto, nova) : Infinity;
    if (agora - ultimoEnvio > 8000 || andou > 25) {
      ultimoEnvio = agora; ultimoPonto = nova;
      api('POST', '/api/entregador/posicao', {
        ...nova,
        precisao_m: p.coords.accuracy,
        velocidade: p.coords.speed,
        rumo: S.rumoAtual,
        order_id: S.navegando?.id ?? null,
        bateria: S.bateria ?? null,
      }).catch(() => { /* rua tem tunel: perder uma batida e normal */ });
    }
  }, (e) => {
    aviso(e.code === 1
      ? 'Sem permissão de localização — a loja não vai te ver no mapa'
      : 'GPS sem sinal agora', true);
  }, { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 });

  navigator.getBattery?.().then((b) => {
    S.bateria = Math.round(b.level * 100);
    b.addEventListener('levelchange', () => { S.bateria = Math.round(b.level * 100); });
  }).catch(() => {});
}

function desligaGps() {
  if (S.vigia !== null) { navigator.geolocation.clearWatch(S.vigia); S.vigia = null; }
}

/* ============ navegacao ============ */

async function navegaAte(entrega) {
  S.navegando = entrega;
  S.tela = 'navegando';
  S.rota = null; S.passoAtual = 0;
  desenha();

  const de = S.pos ?? { lat: S.loja?.lat, lng: S.loja?.lng };
  if (!de?.lat || !entrega.lat) {
    aviso('Sem coordenada para traçar a rota', true);
    return;
  }
  const r = await rotaNavegavel(de, { lat: entrega.lat, lng: entrega.lng });
  if (!r) { aviso('Não consegui traçar a rota agora', true); return; }
  S.rota = r;
  esqueceFalas();
  desenha();
  S.mapa?.poeRota(r.pontos, []);
  desenhaMapa();
  fala(`Rota traçada. ${formataDistancia(r.metros)} até ${entrega.logradouro}, `
    + `${entrega.numero ?? 'sem número'}. ${formataTempo(r.segundos)} de viagem.`,
    { forcar: true });
}

/**
 * Qual manobra vem agora.
 *
 * Procura o passo cujo ponto de manobra esta a frente e mais perto. Sem
 * isso, a tela mostraria a primeira instrucao da lista para sempre — que
 * e o erro classico de navegacao feita as pressas.
 */
function atualizaManobra() {
  if (!S.rota?.passos?.length || !S.pos) return;
  let melhor = S.passoAtual, menor = Infinity;
  S.rota.passos.forEach((passo, i) => {
    if (i < S.passoAtual || !passo.em) return;
    const d = metros(S.pos, passo.em);
    if (d < menor) { menor = d; melhor = i; }
  });
  // passou da manobra: avanca e avisa com uma vibrada curta
  if (menor < 28 && melhor === S.passoAtual && S.passoAtual < S.rota.passos.length - 1) {
    S.passoAtual++;
    vibra([40, 60, 40]);
  } else S.passoAtual = melhor;

  // a voz avisa em tres tempos: longe, perto e na hora. Cada faixa fala
  // uma vez so -- navegador que repete vira ruido, e ruido se desliga
  const passo = S.rota.passos[S.passoAtual];
  if (passo?.em) {
    const d = metros(S.pos, passo.em);
    const faixa = d > 500 ? null : d > 250 ? 'longe' : d > 90 ? 'perto' : 'agora';
    if (faixa) fala(fraseDaManobra(passo, d), { chave: `${S.passoAtual}:${faixa}` });
  }

  const el = $('#manobra');
  if (el) el.innerHTML = cartaoManobra();
  const restante = $('#restante');
  if (restante && S.navegando?.lat) {
    const falta = metros(S.pos, { lat: S.navegando.lat, lng: S.navegando.lng });
    restante.textContent = formataDistancia(falta);
  }
}

function desenhaMapa() {
  if (!S.mapa || !S.pos) return;
  S.mapa.vai(S.pos, { rumoGraus: S.rumoAtual });
}

/* ============ telas ============ */

const ICONE_MANOBRA = {
  esq: 'M26 8 L12 22 L26 36 M12 22 H36',
  dir: 'M22 8 L36 22 L22 36 M36 22 H12',
  'esq-leve': 'M18 8 L10 18 L22 34 M10 18 H34',
  'dir-leve': 'M30 8 L38 18 L26 34 M38 18 H14',
  reto: 'M24 38 V10 M14 20 L24 10 L34 20',
  rotatoria: 'M24 38 V24 A8 8 0 1 1 32 16',
  destino: 'M24 40 C24 40 12 26 12 18 A12 12 0 1 1 36 18 C36 26 24 40 24 40 Z',
};

function cartaoManobra() {
  const p = S.rota?.passos?.[S.passoAtual];
  if (!p) return '<div class="manobra carregando">traçando a rota…</div>';
  const proximo = S.rota.passos[S.passoAtual + 1];
  return `
  <div class="manobra">
    <svg class="ic-manobra" viewBox="0 0 48 48" aria-hidden="true">
      <path d="${ICONE_MANOBRA[p.icone] ?? ICONE_MANOBRA.reto}"
        fill="${p.icone === 'destino' ? 'currentColor' : 'none'}" stroke="currentColor"
        stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <div class="tx-manobra">
      <b>${esc(p.texto)}</b>
      ${p.rua ? `<span>${esc(p.rua)}</span>` : ''}
    </div>
    <div class="dist-manobra">${formataDistancia(p.metros)}</div>
  </div>
  ${proximo ? `<div class="depois">depois · ${esc(proximo.texto)}${
    proximo.rua ? ` em ${esc(proximo.rua)}` : ''}</div>` : ''}`;
}

function telaNavegando() {
  const e = S.navegando;
  const chegada = S.rota
    ? new Date(Date.now() + S.rota.segundos * 1000)
      .toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '—';
  return `
  <div class="nav-tela">
    <div class="nav-mapa" id="navmapa"></div>
    <div class="nav-topo" id="manobra">${cartaoManobra()}</div>

    <div class="nav-botoes">
      <button class="nav-bt ${falaLigada() ? 'on' : ''}" data-acao="voz"
        aria-label="${falaLigada() ? 'Desligar a voz' : 'Ligar a voz'}">
        ${falaLigada() ? '🔊' : '🔇'}</button>
      <button class="nav-bt" data-acao="zoom-mais" aria-label="Aproximar">+</button>
      <button class="nav-bt" data-acao="zoom-menos" aria-label="Afastar">−</button>
      <button class="nav-bt ${S.mapa?.seguindo ? '' : 'solto'}" data-acao="norte"
        aria-label="Girar o mapa">${S.mapa?.seguindo ? '⬆' : 'N'}</button>
    </div>
    <button class="voltar-rota" data-acao="reenquadrar">Voltar para a rota</button>

    <div class="nav-pe">
      <div class="nav-resumo">
        <div class="bloco"><b id="restante">${S.rota ? formataDistancia(S.rota.metros) : '—'}</b>
          <span>restam</span></div>
        <div class="bloco"><b>${S.rota ? formataTempo(S.rota.segundos) : '—'}</b>
          <span>de viagem</span></div>
        <div class="bloco"><b>${chegada}</b><span>chegada</span></div>
      </div>

      <div class="nav-destino">
        <div class="end">
          <b>${esc(e.logradouro)}, ${esc(e.numero ?? 's/n')}</b>
          <span>${esc(e.bairro)}${e.complemento ? ` · ${esc(e.complemento)}` : ''}</span>
        </div>
        <a class="ligar" href="tel:${esc((e.telefone ?? '').replace(/\D/g, ''))}"
           aria-label="Ligar para o cliente">☎</a>
      </div>

      ${e.exige_maos || e.exige_termica || e.coletar_receita ? `
        <div class="nav-selos">
          ${e.exige_termica ? '<span class="selo frio">caixa térmica</span>' : ''}
          ${e.exige_maos ? '<span class="selo maos">entregar em mãos</span>' : ''}
          ${e.coletar_receita ? '<span class="selo receita">recolher a receita</span>' : ''}
        </div>` : ''}

      <div class="nav-acoes">
        <button class="btn-fantasma" data-acao="voltar-fila">Fila</button>
        <button class="btn-grande" data-acao="cheguei" data-id="${esc(e.id)}">Cheguei</button>
      </div>
    </div>
  </div>`;
}

/* ---------- a fila ---------- */

function cartaoEntrega(e, i, minha) {
  const dist = S.pos && e.lat ? metros(S.pos, { lat: e.lat, lng: e.lng }) : null;
  return `
  <article class="corrida ${minha ? 'minha' : ''}">
    <header>
      <span class="ordem">${i + 1}</span>
      <div class="cab">
        <b>${esc(e.logradouro)}, ${esc(e.numero ?? 's/n')}</b>
        <span>${esc(e.bairro)}${e.complemento ? ` · ${esc(e.complemento)}` : ''}</span>
      </div>
      ${dist !== null ? `<span class="perto">${formataDistancia(dist)}</span>` : ''}
    </header>
    <div class="linha-corrida">
      <span class="cod">${esc(e.codigo)}</span>
      <span class="itens">${e.itens} ${e.itens === 1 ? 'item' : 'itens'}</span>
      <span class="quem">${esc(e.cliente)}</span>
    </div>
    ${e.exige_maos || e.exige_termica || e.coletar_receita ? `
      <div class="selos-corrida">
        ${e.exige_termica ? '<span class="selo frio">térmica</span>' : ''}
        ${e.exige_maos ? '<span class="selo maos">em mãos</span>' : ''}
        ${e.coletar_receita ? '<span class="selo receita">recolher receita</span>' : ''}
      </div>` : ''}
    <div class="acoes-corrida">
      ${minha
        ? `<button class="btn-grande" data-acao="navegar" data-id="${esc(e.id)}">Navegar</button>`
        : `<button class="btn-grande claro" data-acao="pegar" data-id="${esc(e.id)}">Pegar esta</button>`}
    </div>
  </article>`;
}

function telaFila() {
  const { minhas, disponiveis } = S.fila;
  // a ordem sugerida sai do ponto onde o piloto esta agora; sem GPS,
  // sai da porta da loja, que e de onde ele vai sair mesmo
  const partida = S.pos ?? { lat: S.loja?.lat, lng: S.loja?.lng };
  const ordenadas = partida?.lat ? melhorOrdem(partida, minhas) : minhas;
  const total = ordenadas.reduce((t, e, i) => {
    const antes = i === 0 ? partida : ordenadas[i - 1];
    return t + (antes?.lat && e.lat ? metros(antes, e) : 0);
  }, 0);

  return `
  <div class="topo-app">
    <div class="eu">
      <span class="foto-eu">${esc((S.eu?.nome ?? '?').slice(0, 2).toUpperCase())}</span>
      <div class="tx">
        <b>${esc(S.eu?.nome ?? '')}</b>
        <span>${esc(S.eu?.veiculo ?? 'moto')}${S.eu?.placa ? ` · ${esc(S.eu.placa)}` : ''}</span>
      </div>
    </div>
    <button class="chave-turno ${S.eu?.em_turno ? 'on' : ''}" data-acao="turno">
      <i></i>${S.eu?.em_turno ? 'em turno' : 'fora'}
    </button>
  </div>

  ${!S.eu?.em_turno ? `
    <div class="cartao-turno">
      <h2>Bora rodar?</h2>
      <p>Entrar em turno mostra as corridas e, se a farmácia ligou o
        rastreamento, deixa o cliente ver a sua moto no mapa.</p>
      <button class="btn-grande" data-acao="turno">Entrar em turno</button>
    </div>`
  : `
    <div class="tira-gps ${S.vigia !== null ? 'ok' : 'off'}">
      <i></i>
      ${S.vigia !== null
        ? (S.eu?.rastreavel
          ? 'Localização ligada · o cliente acompanha'
          : 'Localização ligada · a farmácia desligou o rastreio')
        : '<b>Toque para liberar a localização</b>'}
      ${S.vigia === null ? '<button class="btn-mini" data-acao="gps">Liberar</button>' : ''}
    </div>

    ${ordenadas.length ? `
      <div class="secao-app">
        <h2>Suas entregas</h2>
        <span class="nota">${ordenadas.length} parada${ordenadas.length > 1 ? 's' : ''}
          · ${formataDistancia(total)} na melhor ordem</span>
      </div>
      <div class="lista-corridas">${ordenadas.map((e, i) => cartaoEntrega(e, i, true)).join('')}</div>
      ${ordenadas.length > 1 ? `
        <button class="btn-grande fantasma-largo" data-acao="navegar" data-id="${esc(ordenadas[0].id)}">
          Começar pela mais perto</button>` : ''}`
      : '<div class="vazio-app">Nenhuma corrida sua agora.</div>'}

    ${disponiveis.length ? `
      <div class="secao-app"><h2>No balcão</h2>
        <span class="nota">prontas, esperando alguém pegar</span></div>
      <div class="lista-corridas">${disponiveis.map((e, i) => cartaoEntrega(e, i, false)).join('')}</div>` : ''}
  `}`;
}

function telaEntrar() {
  return `
  <div class="entrar">
    <div class="marca-ent">
      <img src="/icone-192.png" alt="" width="54" height="54">
      <b>Solmedic+ <span>Entregas</span></b>
    </div>
    <h1>Bom dia. Vamos rodar?</h1>
    <p>Entre com a conta que a farmácia criou para você.</p>
    ${S.erro ? `<div class="erro-ent">${esc(S.erro)}</div>` : ''}
    <form id="fent">
      <label>E-mail<input id="email" type="email" autocomplete="username"
        value="entregador@solmedic.com.br"></label>
      <label>Senha<input id="senha" type="password" autocomplete="current-password"
        value="moto123"></label>
      <button class="btn-grande" ${S.ocupado ? 'disabled' : ''}>
        ${S.ocupado ? 'Entrando…' : 'Entrar'}</button>
    </form>
  </div>`;
}

/* ============ desenho e acoes ============ */

function desenha() {
  const raiz = $('#raiz');
  if (!S.token || !S.eu) { raiz.innerHTML = telaEntrar(); return ligaEntrar(); }
  raiz.innerHTML = S.tela === 'navegando' && S.navegando ? telaNavegando() : telaFila();

  if (S.tela === 'navegando') {
    const caixa = $('#navmapa');
    if (caixa && !caixa.dataset.pronto) {
      caixa.dataset.pronto = '1';
      S.mapa = criaNavegacao(caixa);
      if (S.rota) S.mapa.poeRota(S.rota.pontos, []);
      desenhaMapa();
    }
  } else { S.mapa = null; }
}

function ligaEntrar() {
  $('#fent')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    S.ocupado = true; S.erro = null; desenha();
    try {
      const r = await api('POST', '/api/auth/login', {
        email: $('#email').value.trim(), senha: $('#senha').value,
      });
      S.token = r.token; localStorage.setItem('sm_token', r.token);
      S.ocupado = false;
      await carrega();
    } catch (err) {
      S.erro = err.message; S.ocupado = false; desenha();
    }
  });
}

async function carrega() {
  try {
    S.eu = await api('GET', '/api/entregador/eu');
    const f = await api('GET', '/api/entregador/fila');
    S.fila = { minhas: f.minhas, disponiveis: f.disponiveis };
    S.loja = f.loja;
    if (S.eu.em_turno) ligaGps();
    desenha();
  } catch (e) {
    if (e.code === 'NAO_E_ENTREGADOR') {
      S.erro = 'Essa conta não está cadastrada como entregador da farmácia.';
      S.token = null; localStorage.removeItem('sm_token');
    } else S.erro = e.message;
    S.eu = null;
    desenha();
  }
}

document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-acao]');
  if (!b) return;
  const { acao, id } = b.dataset;

  if (acao === 'turno') {
    const entrando = !S.eu.em_turno;
    try {
      S.eu = { ...S.eu, ...(await api('POST', '/api/entregador/turno', { entrando })) };
      if (entrando) { ligaGps(); vibra(30); } else desligaGps();
      await carrega();
    } catch (e) { aviso(e.message, true); }
    return;
  }
  if (acao === 'gps') { ligaGps(); setTimeout(desenha, 400); return; }

  if (acao === 'pegar') {
    try {
      await api('POST', `/api/entregador/entregas/${id}/retirar`, {});
      vibra(40); aviso('Corrida sua. Boa viagem.');
      await carrega();
    } catch (e) { aviso(e.message, true); }
    return;
  }

  if (acao === 'navegar') {
    const e = [...S.fila.minhas, ...S.fila.disponiveis].find((x) => x.id === id);
    if (e) navegaAte(e);
    return;
  }
  /**
   * O botao de voz nao pode redesenhar a tela.
   *
   * Redesenhar recria o mapa do zero -- e o mapa novo nasce apontando
   * para o norte. Era isso que dava a sensacao de que o botao de som
   * "girava o mapa": ele nao girava, ele reiniciava. Aqui so o proprio
   * botao muda.
   */
  if (acao === 'voz') {
    const ligada = alternaVoz();
    b.classList.toggle('on', ligada);
    b.textContent = ligada ? '🔊' : '🔇';
    b.setAttribute('aria-label', ligada ? 'Desligar a voz' : 'Ligar a voz');
    vibra(20);
    if (ligada && S.rota?.passos?.[S.passoAtual]) {
      const passo = S.rota.passos[S.passoAtual];
      const d = S.pos && passo.em ? metros(S.pos, passo.em) : passo.metros;
      fala(fraseDaManobra(passo, d), { forcar: true });
    }
    return;
  }
  if (acao === 'zoom-mais') { S.mapa?.gestos.maisPerto(); vibra(12); return; }
  if (acao === 'zoom-menos') { S.mapa?.gestos.maisLonge(); vibra(12); return; }
  if (acao === 'reenquadrar') { S.mapa?.gestos.reenquadra(); vibra(18); return; }
  if (acao === 'voltar-fila') { S.tela = 'fila'; S.navegando = null; desenha(); return; }
  if (acao === 'norte') {
    if (S.mapa?.seguindo) S.mapa.soltaNorte();
    else { S.mapa?.voltaASeguir(); desenhaMapa(); }
    b.classList.toggle('solto', !S.mapa?.seguindo);
    b.textContent = S.mapa?.seguindo ? '⬆' : 'N';
    return;
  }

  /**
   * "Cheguei" abre a confirmacao de entrega.
   *
   * Nome de quem recebeu e obrigatorio quando o pedido exige entrega em
   * maos — e a mesma regra do servidor, repetida aqui so para o piloto
   * descobrir na calcada e nao depois de subir tres andares.
   */
  if (acao === 'cheguei') {
    const e = S.fila.minhas.find((x) => x.id === id) ?? S.navegando;
    const quem = e?.exige_maos || e?.coletar_receita
      ? prompt('Quem está recebendo? (nome completo)')
      : prompt('Quem recebeu? (deixe vazio se ficou na portaria)') ?? '';
    if (e?.exige_maos && !quem) return aviso('Este pedido exige entrega em mãos', true);
    const receita = e?.coletar_receita
      ? confirm('Você está com a via da receita em mãos?') : false;
    if (e?.coletar_receita && !receita) {
      return aviso('A receita precisa voltar para a farmácia', true);
    }
    try {
      await api('POST', `/api/entregador/entregas/${id}/entregar`, {
        recebido_por: quem || null, receita_coletada: receita,
      });
      vibra([60, 40, 90]);
      aviso('Entregue. Próxima!');
      S.tela = 'fila'; S.navegando = null; S.rota = null;
      await carrega();
    } catch (err) { aviso(err.message, true); }
  }
});

/* a fila se atualiza sozinha: pedido novo no balcao aparece sem F5 */
setInterval(() => { if (S.eu?.em_turno && S.tela === 'fila') carrega(); }, 20000);

if (S.token) carrega(); else desenha();
