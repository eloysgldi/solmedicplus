import { esc, brl, curto, dataBR, quando } from './painel-ui.js';
import { telaVisao } from './painel-visao.js';
import { telaClientes } from './painel-crm.js';
import { telaEstoque } from './painel-estoque.js';
import { telaLoja } from './painel-loja.js';
import { telaFrota } from './painel-frota.js';

const API = location.origin;
const $ = (s, r = document) => r.querySelector(s);
const ROTULO = {
  aguardando_loja: 'novo pedido', aguardando_receita: 'com o farmacêutico',
  em_separacao: 'separando', aguardando_cliente: 'esperando o cliente',
  pronto: 'pronto', em_rota: 'a caminho', entregue: 'entregue', cancelado: 'cancelado',
};

const S = {
  token: localStorage.getItem('sm_token'),
  loja: JSON.parse(localStorage.getItem('sm_loja') || 'null'),
  aba: 'visao',
  // operação
  pedidos: [], receitas: [], retencoes: [], conversas: [], ruptura: [], recalls: [],
  ind: {}, catalogo: [], erro: null,
  // visão geral
  visao: null,
  // clientes
  clientes: [], segmentos: [], cliente: null, clienteAberto: null,
  buscaCliente: '', ordemCliente: 'recentes', segmento: '',
  campanhaAberta: false, campanhaSeg: 'todos', ultimaCampanha: null,
  // estoque
  estoque: [], estoqueResumo: null, abaEstoque: 'posicao', buscaEstoque: '',
  filtroEstoque: 'todos', vencendo: [], abc: [], conferencia: [], movimentos: [],
  eanAberto: null, produtoAberto: null, lotes: [], kardex: [], ultimaEntrada: null,
  // a loja
  lojaDados: null, horarios: [], config: null,
  // a frota
  frota: [], posicoes: [], alertas: null,
};

async function api(metodo, caminho, corpo) {
  const res = await fetch(API + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(dados.mensagem || 'Falhou'), { code: dados.erro, status: res.status });
  return dados;
}

// ---------- login ----------
function telaLogin(msg) {
  $('#raiz').innerHTML = `
    <div class="login">
      <div class="marca"><span class="lg"><svg width="20" height="20" viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="#fff" stroke-width="19" stroke-linecap="round"><path d="M53.5 28.5 C53.5 43.5 34 39.5 27.7 50.5"/><path d="M46.5 71.5 C46.5 56.5 66 60.5 72.3 49.5"/></g></svg></span><div><b>Solmedic+</b><span>painel da farmácia</span></div></div>
      <form id="f">
        <label for="email">E-mail</label>
        <input id="email" type="email" value="gerente@solmedic.com.br" autocomplete="username">
        <label for="senha">Senha</label>
        <input id="senha" type="password" value="loja123" autocomplete="current-password">
        <button class="btn p" style="width:100%;justify-content:center;margin-top:16px">Entrar</button>
      </form>
      ${msg ? `<div class="erro">${esc(msg)}</div>` : ''}
      <p style="font-size:12px;color:var(--ink-3);margin-top:16px;line-height:1.6">
        gerente@solmedic.com.br · loja123 &nbsp;|&nbsp; farmaceutica@solmedic.com.br · crf123 (farmacêutica)
        <br><a href="/" style="color:var(--brand);font-weight:700;text-decoration:none">
        ← Sou cliente, quero comprar</a>
        &nbsp;·&nbsp;
        <a href="/entregador.html" style="color:var(--brand);font-weight:700;text-decoration:none">
        Sou entregador →</a>
      </p>
    </div>`;
  $('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', '/api/auth/login', { email: $('#email').value, senha: $('#senha').value });
      S.token = r.token; localStorage.setItem('sm_token', r.token);
      const eu = await api('GET', '/api/auth/eu');
      if (!eu.lojas?.length) return telaLogin('Essa conta não opera nenhuma farmácia.');
      S.loja = eu.lojas[0]; S.eu = eu;
      localStorage.setItem('sm_loja', JSON.stringify(S.loja));
      iniciar();
    } catch (err) { telaLogin(err.message); }
  });
}

/**
 * Carrega só o que a aba aberta precisa.
 *
 * O painel é um sistema inteiro agora; puxar tudo a cada tique de SSE
 * seria dezenas de consultas por minuto para mostrar uma tela só.
 */
async function carregar() {
  const pid = S.loja.pharmacy_id;
  const pega = (rota, padrao) => api('GET', `/api/comercio/${pid}${rota}`).catch(() => padrao);

  const [pedidos, ind] = await Promise.all([pega('/pedidos', []), pega('/indicadores', {})]);
  S.pedidos = pedidos; S.ind = ind;

  if (S.loja.papel === 'farmaceutico' || S.loja.papel === 'gerente') {
    S.receitas = await pega('/receitas', []);
    S.retencoes = await pega('/receitas/retencao', []);
    S.conversas = await pega('/conversas', []);
  }
  if (S.aba === 'visao') {
    S.visao = await pega('/visao', null);
    S.alertas = await pega('/alertas', null);
  }
  if ((S.aba === 'receitas' || S.aba === 'ruptura') && !S.catalogo.length) {
    S.catalogo = await pega('/catalogo', []);
  }
  if (S.aba === 'catalogo') S.catalogo = await pega('/catalogo', []);
  if (S.aba === 'ruptura') {
    S.ruptura = await pega('/ruptura', []);
    S.recalls = await pega('/recalls', []);
  }
  if (S.aba === 'clientes') {
    S.segmentos = await pega('/clientes/segmentos', []);
    if (S.clienteAberto) S.cliente = await pega(`/clientes/${S.clienteAberto}`, null);
    else {
      const q = new URLSearchParams({ q: S.buscaCliente, segmento: S.segmento, ordem: S.ordemCliente });
      S.clientes = await pega(`/clientes?${q}`, []);
    }
  }
  if (S.aba === 'estoque') await carregaEstoque(pid, pega);
  if (S.aba === 'frota') {
    S.frota = await pega('/entregadores', []);
    S.posicoes = await pega('/frota/posicoes', []);
  }
  if (S.aba === 'loja') {
    S.lojaDados = await pega('', null);
    S.horarios = S.lojaDados?.horarios ?? [];
    S.config = await api('GET', '/api/config').catch(() => null);
    if (!S.catalogo.length) S.catalogo = await pega('/catalogo', []);
  }
  desenhar();
}

async function carregaEstoque(pid, pega) {
  S.estoqueResumo = await pega('/estoque/resumo', {});
  if (S.eanAberto) {
    S.lotes = await pega(`/estoque/${S.eanAberto}/lotes`, []);
    S.kardex = await pega(`/estoque/${S.eanAberto}/kardex`, []);
    if (!S.estoque.some((i) => i.ean === S.eanAberto)) {
      S.produtoAberto = (await pega(`/estoque?q=${encodeURIComponent(S.eanAberto)}`, []))
        .find((i) => i.ean === S.eanAberto) ?? null;
    }
    return;
  }
  if (S.abaEstoque === 'vencendo') S.vencendo = await pega('/estoque/vencendo', []);
  else if (S.abaEstoque === 'abc') S.abc = await pega('/estoque/abc', []);
  else if (S.abaEstoque === 'conferencia') S.conferencia = await pega('/estoque/conferencia', []);
  else if (S.abaEstoque === 'entrada') {
    if (!S.catalogo.length) S.catalogo = await pega('/catalogo', []);
    S.movimentos = await pega('/estoque/movimentos', []);
  } else {
    const q = new URLSearchParams({ q: S.buscaEstoque, filtro: S.filtroEstoque });
    S.estoque = await pega(`/estoque?${q}`, []);
  }
}

async function acao(fn) {
  try { await fn(); S.erro = null; } catch (e) { S.erro = e.message; }
  await carregar();
}

/**
 * A navegação em três blocos.
 *
 * Operação é o que muda a cada minuto; gestão é o que se olha uma vez
 * por dia; a loja é o que se mexe uma vez por mês. Misturar os três numa
 * lista só foi o que fez o painel antigo parecer um menu de restaurante.
 */
function navegacao() {
  const novos = S.pedidos.filter((p) => p.status === 'aguardando_loja').length;
  const rx = S.loja.papel === 'farmaceutico' || S.loja.papel === 'gerente';
  const grupos = [
    ['operação', [
      ['visao', 'Visão geral', 0, ''],
      ['pedidos', 'Pedidos', novos, ''],
      ...(rx ? [['receitas', 'Receitas', S.receitas.length, 'rx'],
                ['retencao', 'Retenções', S.retencoes.length, 'ret'],
                ['conversas', 'Conversas', S.conversas.length, 'rx']] : []),
    ]],
    ['gestão', [
      ['clientes', 'Clientes', 0, ''],
      ['frota', 'Frota', 0, ''],
      ['estoque', 'Estoque', S.ind.estoque_zerado ?? 0, 'ret'],
      ['catalogo', 'Catálogo', 0, ''],
      ['ruptura', 'Ruptura e recall', 0, ''],
      ['financeiro', 'Financeiro', 0, ''],
    ]],
    ['a casa', [['loja', 'A loja', 0, '']]],
  ];

  return grupos.map(([titulo, itens]) => `
    <div class="grupo-nav"><span class="tit-nav">${titulo}</span>
      ${itens.map(([k, t, n, cls]) => `
        <button data-aba="${k}" class="${S.aba === k ? 'on' : ''}">${t}
          ${n ? `<span class="n ${cls}">${n}</span>` : ''}</button>`).join('')}
    </div>`).join('');
}

// ---------- desenho ----------
function desenhar() {
  const pid = S.loja.pharmacy_id;
  $('#raiz').innerHTML = `
  <div class="app">
    <aside class="rail">
      <div class="marca"><span class="lg"><svg width="20" height="20" viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="#fff" stroke-width="19" stroke-linecap="round"><path d="M53.5 28.5 C53.5 43.5 34 39.5 27.7 50.5"/><path d="M46.5 71.5 C46.5 56.5 66 60.5 72.3 49.5"/></g></svg></span>
        <div><b>${esc(S.loja.nome_fantasia)}</b><span>● no ar</span></div></div>
      <nav>${navegacao()}</nav>
      <div class="kpis">
        <div class="kpi"><div class="k">faturado hoje</div><div class="v">${brl(S.ind.bruto_centavos)}</div></div>
        <div class="kpi"><div class="k">pedidos hoje</div><div class="v">${S.ind.pedidos_hoje ?? 0}</div></div>
        <div class="kpi"><div class="k">ruptura</div><div class="v">${S.ind.ruptura_pct ?? 0}%</div></div>
        ${S.ind.retencoes_pendentes ? `<div class="kpi"><div class="k">vias a arquivar</div>
          <div class="v" style="color:var(--red)">${S.ind.retencoes_pendentes}</div></div>` : ''}
        <button class="btn g sm" id="sair" style="margin-top:6px;justify-content:center">Sair</button>
      </div>
    </aside>
    <main>${S.erro ? `<div class="erro" style="margin-bottom:16px">${esc(S.erro)}</div>` : ''}${painel()}</main>
    <datalist id="catalogo-loja">${S.catalogo.map((p) =>
      `<option value="${esc(p.ean)}">${esc(p.nome)} · ${esc(p.apresentacao ?? '')}</option>`).join('')}</datalist>
  </div>`;

  $('#raiz').querySelectorAll('[data-aba]').forEach((b) =>
    b.addEventListener('click', () => trocaAba(b.dataset.aba)));
  $('#sair').addEventListener('click', () => { localStorage.clear(); location.reload(); });

  ligaCampos(pid);
}

/** Trocar de aba zera o que era daquela aba. Estado velho em tela nova mente. */
function trocaAba(aba) {
  S.aba = aba; S.erro = null;
  S.ultimoRecall = null; S.ultimaEntrada = null; S.ultimaCampanha = null;
  S.clienteAberto = null; S.cliente = null; S.campanhaAberta = false;
  S.eanAberto = null; S.produtoAberto = null;
  carregar();
}

/** Campos que salvam sozinhos ao sair, e a foto que sobe ao ser escolhida. */
function ligaCampos(pid) {
  $('#raiz').querySelectorAll('[data-preco]').forEach((inp) =>
    inp.addEventListener('change', () => acao(() => api('POST', `/api/comercio/${pid}/catalogo`, {
      ean: inp.dataset.preco,
      preco_centavos: Math.round(parseFloat(inp.value.replace(',', '.')) * 100),
      preco_socio_centavos: Number(inp.dataset.socio) || null,
      estoque: Number(inp.dataset.estoque),
    }))));
  $('#raiz').querySelectorAll('[data-estoque-ean]').forEach((inp) =>
    inp.addEventListener('change', () => acao(() => api('POST', `/api/comercio/${pid}/catalogo`, {
      ean: inp.dataset.estoqueEan, preco_centavos: Number(inp.dataset.preco2),
      preco_socio_centavos: Number(inp.dataset.socio) || null, estoque: Number(inp.value),
    }))));

  const busca = (id, campo) => {
    const el = $('#' + id); if (!el) return;
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { S[campo] = el.value; carregar(); } });
    el.addEventListener('search', () => { S[campo] = el.value; carregar(); });
  };
  busca('busca-cliente', 'buscaCliente');
  busca('busca-estoque', 'buscaEstoque');

  $('#ordem-cliente')?.addEventListener('change', (e) => { S.ordemCliente = e.target.value; carregar(); });

  // a foto sobe no momento em que é escolhida: ninguém procura "salvar"
  $('#raiz').querySelectorAll('[data-foto]').forEach((inp) =>
    inp.addEventListener('change', async () => {
      const arq = inp.files?.[0]; if (!arq) return;
      const dados = await new Promise((ok) => {
        const fr = new FileReader();
        fr.onload = () => ok(String(fr.result).split(',')[1]);
        fr.readAsDataURL(arq);
      });
      acao(() => api('POST', `/api/comercio/${pid}/catalogo/${inp.dataset.foto}/foto`, { dados }));
    }));
}

function painel() {
  if (S.aba === 'visao') return telaVisao({ S });
  if (S.aba === 'clientes') return telaClientes({ S });
  if (S.aba === 'estoque') return telaEstoque({ S });
  if (S.aba === 'loja') return telaLoja({ S });
  if (S.aba === 'frota') return telaFrota({ S });
  if (S.aba === 'receitas') return telaReceitas();
  if (S.aba === 'retencao') return telaRetencao();
  if (S.aba === 'conversas') return telaConversas();
  if (S.aba === 'ruptura') return telaRuptura();
  if (S.aba === 'catalogo') return telaCatalogo();
  if (S.aba === 'financeiro') return telaFinanceiro();
  return telaPedidos();
}

function telaPedidos() {
  if (!S.pedidos.length) return `<h1>Pedidos</h1><p class="sub">Nada na fila agora.</p>
    <div class="card"><div class="vazio">Quando um pedido entrar, ele aparece aqui sozinho — sem F5.</div></div>`;
  return `<h1>Pedidos</h1>
    <p class="sub">${S.pedidos.length} em andamento. A tela se atualiza sozinha quando algo muda.</p>
    ${S.pedidos.map(cardPedido).join('')}`;
}

function cardPedido(p) {
  const pendente = p.status === 'aguardando_loja';
  const seg = pendente && p.prazo_aceite_em
    ? Math.max(0, Math.round((Date.parse(p.prazo_aceite_em) - Date.now()) / 1000)) : null;
  const podeMexer = ['em_separacao', 'aguardando_cliente'].includes(p.status);
  return `
  <div class="card">
    <header>
      <div><div class="cod">${esc(p.codigo)} · ${new Date(p.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
        <div class="nm">${esc(p.cliente?.nome ?? '')} · ${p.itens.length} ${p.itens.length === 1 ? 'item' : 'itens'}</div></div>
      <span class="pill ${p.status}">${ROTULO[p.status] ?? p.status}</span>
      ${seg !== null ? `<div class="linha" style="margin-left:auto">
        <div class="ring"><svg width="44" height="44" viewBox="0 0 44 44" style="transform:rotate(-90deg)">
          <circle cx="22" cy="22" r="18" fill="none" stroke="var(--line)" stroke-width="4"/>
          <circle cx="22" cy="22" r="18" fill="none" stroke="var(--amber-solid)" stroke-width="4"
            stroke-linecap="round" stroke-dasharray="113" stroke-dashoffset="${(113 * (1 - seg / 90)).toFixed(1)}"/>
        </svg><span class="t">${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}</span></div>
        <span style="font-size:12px;color:var(--ink-3);max-width:9ch;line-height:1.25">para aceitar</span></div>` : ''}
      ${p.entrega?.exige_maos ? '<span class="pill" style="background:var(--rx-bg);color:var(--rx)">em mãos</span>' : ''}
      ${p.entrega?.exige_termica ? '<span class="pill" style="background:#E7EEF9;color:#26558F">caixa térmica</span>' : ''}
    </header>

    ${p.ofertas?.length ? `<div class="aviso">⇄ Contraproposta enviada: <b>${esc(p.ofertas[0].nome_oferecido)}</b>
      por ${brl(p.ofertas[0].preco_centavos)}. Esperando o cliente responder.</div>` : ''}

    ${p.itens.map((i) => `
      <div class="item ${i.requer_receita ? 'rx' : ''}">
        <i class="tj"></i>
        <div class="in"><b>${esc(i.nome_snapshot)}</b>
          <span>${esc(i.ean)}${i.dosagem_snapshot ? ' · ' + esc(i.dosagem_snapshot) : ''}${i.requer_receita ? ' · tarja vermelha' : ''}${i.status === 'indisponivel' ? ' · EM FALTA' : ''}${i.status === 'substituido' ? ' · substituído' : ''}</span></div>
        <span class="qt">${i.qtd}×</span>
        <span class="qt">${brl(i.preco_total_centavos)}</span>
        ${podeMexer && i.status !== 'indisponivel' ? `
          <button class="btn g sm" data-acao="falta" data-oid="${p.id}" data-item="${i.id}">não tenho</button>` : ''}
        ${podeMexer && i.status === 'indisponivel' ? `
          <button class="btn a sm" data-acao="trocar" data-oid="${p.id}" data-item="${i.id}">⇄ oferecer outro</button>` : ''}
      </div>`).join('')}

    <div class="rodape">
      ${pendente ? `<button class="btn p" data-acao="aceitar" data-oid="${p.id}">Aceitar e separar</button>
                    <button class="btn d" data-acao="recusar" data-oid="${p.id}">Recusar</button>` : ''}
      ${p.status === 'aguardando_receita' ? `<span style="font-size:13.5px;color:var(--rx)">
        ℞ Esperando o farmacêutico liberar. Os itens de venda livre já podem ser separados.</span>` : ''}
      ${p.status === 'em_separacao' ? `<button class="btn p" data-acao="pronto" data-oid="${p.id}">Separado e conferido</button>` : ''}
      ${p.status === 'pronto' ? `<button class="btn p" data-acao="despachar" data-oid="${p.id}">Entregar ao motoboy</button>` : ''}
      <span class="tot">${brl(p.total_centavos)}</span>
    </div>
  </div>`;
}

function telaReceitas() {
  const podeLiberar = S.loja.papel === 'farmaceutico';
  if (!S.receitas.length) return `<h1>Receitas</h1>
    <p class="sub">Fila do farmacêutico responsável.</p>
    <div class="card"><div class="vazio">Nenhuma receita esperando conferência.</div></div>`;
  return `<h1>Receitas</h1>
    <p class="sub">${S.receitas.length} esperando. ${podeLiberar
      ? `Você assina como <b>${esc(S.loja.crf ? 'CRF-' + S.loja.crf_uf + ' ' + S.loja.crf : '')}</b>.`
      : '<b>Só um farmacêutico com CRF pode liberar.</b> Você está vendo em modo leitura.'}</p>
    ${S.receitas.map((r) => `
    <div class="card cartao-receita">
      <div class="dois">
        <div class="papel">
          <div class="h">RECEITUÁRIO</div>
          ${esc(r.itens.map((i) => i.principio_ativo).join(', '))}
          <div class="mao">${r.itens.map((i) => `${esc(i.dosagem ?? '')}<br>${esc(i.posologia ?? '')}<br>${i.qtd_prescrita} caixa(s)`).join('<br>')}</div>
          <div class="sig">${esc(r.prescritor_nome ?? '—')}<br>CRM-${esc(r.prescritor_uf ?? '')} ${esc(r.prescritor_crm ?? '')}<br>${esc(r.emitida_em ?? '')}</div>
        </div>
        <div>
          <h3 style="margin:0 0 4px;font-size:17px">Conferência</h3>
          <p style="margin:0 0 14px;font-size:13.5px;color:var(--ink-2)">
            O sistema não decide nada aqui. Ele organiza o que precisa ser olhado e guarda quem olhou.</p>
          <table>
            <tr><th>campo</th><th>na receita</th></tr>
            <tr><td>Prescritor</td><td>${esc(r.prescritor_nome ?? '—')} · CRM ${esc(r.prescritor_crm ?? '—')}</td></tr>
            <tr><td>Emitida em</td><td class="mono">${esc(r.emitida_em ?? '—')}</td></tr>
            <tr><td>Válida até</td><td class="mono">${esc(r.valida_ate ?? 'uso contínuo')}</td></tr>
            <tr><td>Quantidade</td><td class="mono">${r.itens.map((i) => `${i.qtd_prescrita} prescrita(s), saldo ${i.saldo}`).join(' · ')}</td></tr>
          </table>
          ${r.itens.length ? '' : `
          <div class="aviso" style="margin:14px 0 0">
            ⚠ Essa receita chegou como foto, sem medicamento nem dose. Leia o papel e preencha —
            sem isso não existe dispensação.
          </div>
          <div style="margin-top:12px;display:grid;gap:8px">
            <div class="linha" style="gap:8px;flex-wrap:wrap">
              <input class="ent" name="prescritor" placeholder="Nome do prescritor" style="flex:2;min-width:160px">
              <input class="ent" name="crm" placeholder="CRM" style="width:90px">
              <input class="ent" name="uf" placeholder="UF" style="width:64px" maxlength="2">
              <input class="ent" name="emitida" type="date" style="width:150px">
            </div>
            <div class="linha" style="gap:8px;flex-wrap:wrap">
              <input class="ent" name="ean" list="catalogo-loja" placeholder="EAN ou nome do medicamento" style="flex:2;min-width:200px">
              <input class="ent" name="qtd" type="number" min="1" value="1" placeholder="qtd" style="width:80px">
              <input class="ent" name="posologia" placeholder="Posologia" style="flex:2;min-width:160px">
            </div>
            <label class="linha" style="gap:8px;font-size:13px;color:var(--ink-2)">
              <input type="checkbox" name="continuo"> uso contínuo (gera saldo em vez de consumir a receita inteira)
            </label>
            <div><button class="btn g" data-acao="preencher" data-rid="${r.id}"
              ${podeLiberar ? '' : 'disabled'}>Salvar leitura</button></div>
          </div>`}
          <div class="linha" style="margin-top:16px;flex-wrap:wrap">
            <button class="btn p" data-acao="liberar" data-rid="${r.id}" ${podeLiberar ? '' : 'disabled'}>Liberar item</button>
            <button class="btn d" data-acao="negar" data-rid="${r.id}" ${podeLiberar ? '' : 'disabled'}>Recusar com motivo</button>
          </div>
        </div>
      </div>
    </div>`).join('')}`;
}

function telaRetencao() {
  const podeReter = S.loja.papel === 'farmaceutico';
  if (!S.retencoes.length) return `<h1>Retenções</h1>
    <p class="sub">Vias de receita que saíram com o entregador e ainda não voltaram para o arquivo da loja.</p>
    <div class="card"><div class="vazio">Nenhuma via pendente. Arquivo em dia.</div></div>`;
  return `<h1>Retenções</h1>
    <p class="sub">${S.retencoes.length} via(s) de papel a arquivar.
    ${podeReter ? 'Confira o papel que o entregador trouxe e registre.'
      : '<b>Só farmacêutico com CRF registra retenção.</b> Você está em modo leitura.'}</p>
    ${S.retencoes.map((r) => `
    <div class="card cartao-retencao">
      <header>
        <div><div class="cod">${esc(r.id.slice(0, 8))} · liberada ${r.validada_em ? new Date(r.validada_em).toLocaleString('pt-BR') : ''}</div>
          <div class="onm">${esc(r.itens.map((i) => i.principio_ativo || i.ean).join(', '))}</div></div>
        <span class="pill" style="background:#FBE9EC;color:var(--red)">via física pendente</span>
      </header>
      <div style="padding:14px 16px">
        <p style="margin:0 0 12px;font-size:13.4px;color:var(--ink-2);line-height:1.5">
          ${esc(r.prescritor_nome ?? '—')} · CRM-${esc(r.prescritor_uf ?? '')} ${esc(r.prescritor_crm ?? '')}
          · emitida ${esc(r.emitida_em ?? '—')} · vence ${esc(r.valida_ate ?? '—')}<br>
          Anote no verso da via e arquive: registro, quantidade dispensada, lote e validade.
        </p>
        <div class="linha" style="gap:8px;flex-wrap:wrap">
          <input class="ent" name="registro" placeholder="Nº de registro" style="width:150px">
          <input class="ent" name="qtd" type="number" min="1" value="${r.itens[0]?.qtd_prescrita ?? 1}"
                 placeholder="qtd" style="width:80px">
          <input class="ent" name="lote" placeholder="Lote" style="width:130px">
          <input class="ent" name="validade" type="date" style="width:150px">
          <button class="btn p" data-acao="reter" data-rid="${r.id}" ${podeReter ? '' : 'disabled'}>
            Registrar retenção</button>
        </div>
      </div>
    </div>`).join('')}`;
}

function lerPreenchimento(cartao) {
  const v = (n) => cartao.querySelector(`[name="${n}"]`)?.value?.trim() || '';
  const ean = (v('ean').match(/\d{8,14}/) || [v('ean')])[0];
  return {
    prescritor: { nome: v('prescritor'), crm: v('crm'), uf: v('uf').toUpperCase() },
    emitida_em: v('emitida') || undefined,
    uso_continuo: cartao.querySelector('[name="continuo"]')?.checked ? 1 : 0,
    itens: ean ? [{ ean, qtd_prescrita: Number(v('qtd') || 1), posologia: v('posologia') }] : [],
  };
}

function lerRetencao(cartao) {
  const v = (n) => cartao.querySelector(`[name="${n}"]`)?.value?.trim() || '';
  return {
    registro_numero: v('registro'),
    quantidade_dispensada: Number(v('qtd') || 0),
    lote: v('lote'),
    validade_lote: v('validade') || undefined,
  };
}

function telaConversas() {
  const podeResponder = S.loja.papel === 'farmaceutico';
  if (!S.conversas.length) return `<h1>Conversas</h1>
    <p class="sub">Dúvidas de cliente esperando orientação.</p>
    <div class="card"><div class="vazio">Ninguém esperando. Tudo respondido.</div></div>`;
  return `<h1>Conversas</h1>
    <p class="sub">${S.conversas.length} esperando.
      ${podeResponder ? `Você assina como <b>CRF-${esc(S.loja.crf_uf ?? '')} ${esc(S.loja.crf ?? '')}</b>.`
        : '<b>Orientação farmacêutica é privativa de quem tem CRF.</b> Você está em modo leitura.'}</p>
    ${S.conversas.map((c) => `
    <div class="card cartao-conversa">
      <header>
        <div><div class="cod">${esc(c.cliente?.nome ?? '')} · ${new Date(c.mexido_em).toLocaleString('pt-BR')}</div>
          <div class="onm">${esc(c.mensagens.filter((m) => m.autor_tipo === 'cliente').at(-1)?.texto?.slice(0, 60) ?? 'Conversa')}</div></div>
        <span class="pill ${c.status === 'aberta' ? 'aguardando_loja' : 'entregue'}">${c.status}</span>
      </header>
      <div class="linha-do-fio">
        ${c.mensagens.map((m) => m.autor_tipo === 'sistema' ? '' : `
          <div class="msg ${m.autor_tipo}">
            <b>${esc(m.autor_tipo === 'cliente' ? (c.cliente?.nome ?? 'Cliente') : m.autor_nome ?? '')}
              ${m.crf ? `<span class="crf-msg">${esc(m.crf)}</span>` : ''}</b>
            <p>${esc(m.texto)}</p>
            <span class="quando-msg">${new Date(m.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>`).join('')}
      </div>
      <div class="rodape">
        <textarea class="ent" name="resposta" rows="2" placeholder="Responder como farmacêutico"
          style="flex:1;min-width:220px;resize:vertical" ${podeResponder ? '' : 'disabled'}></textarea>
        <button class="btn p" data-acao="responder" data-cid="${c.id}" ${podeResponder ? '' : 'disabled'}>Responder</button>
        <button class="btn g" data-acao="fechar-conversa" data-cid="${c.id}" ${podeResponder ? '' : 'disabled'}>Encerrar</button>
      </div>
    </div>`).join('')}`;
}

function blocoRecall() {
  const podeRecolher = ['farmaceutico', 'gerente'].includes(S.loja.papel);
  return `
  <div class="card bloco-recall">
    <header>
      <div><div class="cod">rastreabilidade</div>
        <div class="onm">Recolhimento de lote</div></div>
      <span class="pill" style="background:#FBE9EC;color:var(--red)">crítico</span>
    </header>
    <div style="padding:14px 16px">
      <p style="margin:0 0 14px;font-size:13.4px;color:var(--ink-2);line-height:1.5">
        Cada caixa que sai daqui leva lote e validade gravados no pedido. Registrar
        um recolhimento <b>avisa na hora quem levou aquele lote</b> — pelo nome, no
        celular — em vez de publicar um comunicado que ninguém lê.
      </p>
      <div class="linha" style="gap:8px;flex-wrap:wrap">
        <input class="ent" name="ean" list="catalogo-loja" placeholder="EAN ou nome do produto"
               style="flex:2;min-width:200px">
        <input class="ent" name="lote" placeholder="Lote (vazio = todos)" style="width:170px">
      </div>
      <div class="linha" style="gap:8px;flex-wrap:wrap;margin-top:8px">
        <select class="ent" name="origem" style="width:150px">
          <option value="anvisa">Anvisa</option>
          <option value="fabricante">Fabricante</option>
          <option value="interno">Interno</option>
        </select>
        <input class="ent" name="ref" placeholder="Nº da resolução" style="width:160px">
        <input class="ent" name="motivo" placeholder="Motivo — o cliente vai ler isto"
               style="flex:2;min-width:220px">
      </div>
      <div class="linha" style="margin-top:12px">
        <button class="btn d" data-acao="recolher" ${podeRecolher ? '' : 'disabled'}>
          Recolher e avisar quem levou</button>
      </div>
      ${S.ultimoRecall ? `
        <div class="ok" style="margin-top:14px">
          ✓ ${esc(S.ultimoRecall.produto)}${S.ultimoRecall.lote ? `, lote ${esc(S.ultimoRecall.lote)}` : ''}
          — <b>${S.ultimoRecall.atingidos} cliente(s) avisado(s)</b>:
          ${esc(S.ultimoRecall.avisados.map((a) => a.cliente).join(', ') || '—')}
        </div>` : ''}
    </div>
  </div>

  ${S.recalls.length ? `
    <div class="card"><table>
      <tr><th>quando</th><th>produto</th><th>lote</th><th>origem</th>
          <th style="text-align:right">avisados</th></tr>
      ${S.recalls.map((r) => `
        <tr><td class="mono">${new Date(r.criado_em).toLocaleDateString('pt-BR')}</td>
          <td><b>${esc(r.produto)}</b><br><span style="font-size:11.5px;color:var(--ink-3)">${esc(r.motivo)}</span></td>
          <td class="mono">${esc(r.lote ?? 'todos')}</td>
          <td>${esc(r.origem)}${r.referencia ? ` · ${esc(r.referencia)}` : ''}</td>
          <td style="text-align:right" class="mono"><b>${r.atingidos}</b></td></tr>`).join('')}
    </table></div>` : ''}`;
}

function telaRuptura() {
  if (!S.ruptura.length) return `<h1>Ruptura e recall</h1>
    <p class="sub">O que vai faltar antes de faltar — e o que precisa voltar.</p>
    <div class="card"><div class="vazio">Nada perto de zerar nos próximos 5 dias.</div></div>
    ${blocoRecall()}`;
  return `<h1>Ruptura e recall</h1>
    <p class="sub">Projeção pelo ritmo das últimas duas semanas.
      <b>"Acabou" é o aviso que chega tarde</b> — aqui dá tempo de comprar.</p>
    <div class="card"><table>
      <tr><th>posição</th><th>produto</th><th style="text-align:right">estoque</th>
          <th style="text-align:right">sai/dia</th><th style="text-align:right">zera em</th></tr>
      ${S.ruptura.map((r) => `
        <tr>
          <td><span class="posicao">${esc(r.posicao ?? '—')}</span></td>
          <td><b>${esc(r.nome)}</b></td>
          <td style="text-align:right" class="mono"
            ${r.estoque <= 0 ? 'style="text-align:right;color:var(--red);font-weight:700"' : ''}>${r.estoque}</td>
          <td style="text-align:right" class="mono">${r.por_dia}</td>
          <td style="text-align:right" class="mono">
            ${r.estoque <= 0 ? '<b style="color:var(--red)">zerado</b>'
              : `<b style="color:${r.dias_para_zerar <= 2 ? 'var(--red)' : 'var(--amber)'}">${r.dias_para_zerar} dias</b>`}</td>
        </tr>`).join('')}
    </table></div>
    ${blocoRecall()}`;
}

/**
 * Catálogo.
 *
 * Preço e estoque continuam editáveis na tabela — é o que a loja mexe
 * todo dia. A foto entra por aqui também: sem foto real, o cliente vê
 * o desenho vetorial, e desenho vende menos que caixa.
 */
function telaCatalogo() {
  const semFoto = S.catalogo.filter((p) => !p.imagem_url).length;
  return `<h1>Catálogo</h1>
    <p class="sub">O produto é da plataforma; <b>o preço, o estoque e a foto são seus</b>.
    Editar aqui já muda o app do cliente. O sistema recusa preço acima do PMC da CMED.</p>

    ${semFoto ? `
      <div class="tira-alertas">
        <button class="alerta morno" data-aba="estoque"><span class="pt"></span>
          ${semFoto} produto(s) sem foto real — o app mostra o desenho no lugar</button>
      </div>` : ''}

    <div class="card">
      <table>
        <tr><th></th><th>produto</th><th>tarja</th><th style="text-align:right">preço</th>
            <th style="text-align:right">sócio</th><th style="text-align:right">estoque</th><th>PMC</th></tr>
        ${S.catalogo.map((p) => `
        <tr>
          <td style="width:46px">
            <label class="foto-celula" title="${p.imagem_url ? 'trocar a foto' : 'subir foto real'}">
              ${p.imagem_url ? `<img class="mini-foto" src="${esc(p.imagem_url)}" alt="">`
                : '<span class="mini-foto vazia"></span>'}
              <input type="file" accept="image/jpeg,image/png,image/webp" data-foto="${esc(p.ean)}" hidden>
            </label>
          </td>
          <td><b>${esc(p.nome)}</b><br><span class="mono" style="font-size:11px;color:var(--ink-3)">${esc(p.ean)} · ${esc(p.apresentacao ?? '')}</span></td>
          <td>${p.tarja === 'livre' ? '<span class="pill">livre</span>'
              : `<span class="pill" style="background:#FBE9EC;color:var(--red)">${esc(p.tarja)}</span>`}</td>
          <td style="text-align:right"><input data-preco="${p.ean}" data-socio="${p.preco_socio_centavos ?? ''}"
              data-estoque="${p.estoque}" value="${((p.preco_centavos) / 100).toFixed(2).replace('.', ',')}"></td>
          <td style="text-align:right" class="mono">${p.preco_socio_centavos ? brl(p.preco_socio_centavos) : '—'}</td>
          <td style="text-align:right"><input data-estoque-ean="${p.ean}" data-preco2="${p.preco_centavos}"
              data-socio="${p.preco_socio_centavos ?? ''}" value="${p.estoque}"
              style="width:62px;${p.estoque <= 0 ? 'border-color:var(--red);color:var(--red)' : ''}"></td>
          <td class="mono" style="font-size:12px;color:var(--ink-3)">${p.pmc_centavos ? brl(p.pmc_centavos) : '—'}</td>
        </tr>`).join('')}
      </table>
    </div>

    <p class="fino" style="margin-top:12px;line-height:1.6">
      Clique na miniatura para subir a foto de um produto. Para subir muitas de uma vez,
      nomeie cada arquivo com o EAN (7891142199058.jpg) e rode
      <code>node server/fotos.js "caminho/da/pasta"</code> — 300 fotos entram em dez segundos.
    </p>`;
}

function telaFinanceiro() {
  const i = S.ind;
  return `<h1>Financeiro</h1>
    <p class="sub">Comissão da plataforma sobre o valor dos produtos. O frete é repassado inteiro.</p>
    <div class="card"><table>
      <tr><th>hoje</th><th style="text-align:right">valor</th></tr>
      <tr><td>Bruto entregue</td><td style="text-align:right" class="mono">${brl(i.bruto_centavos)}</td></tr>
      <tr><td>Comissão Solmedic+</td><td style="text-align:right" class="mono">− ${brl(i.comissao_centavos)}</td></tr>
      <tr style="background:var(--wash)"><td><b>A receber</b></td>
          <td style="text-align:right" class="mono"><b>${brl(i.a_receber_centavos)}</b></td></tr>
    </table></div>
    <div class="card"><table>
      <tr><th>operação</th><th style="text-align:right">hoje</th></tr>
      <tr><td>Pedidos recebidos</td><td style="text-align:right" class="mono">${i.pedidos_hoje ?? 0}</td></tr>
      <tr><td>Entregues</td><td style="text-align:right" class="mono">${i.entregues_hoje ?? 0}</td></tr>
      <tr><td>Cancelados</td><td style="text-align:right" class="mono">${i.cancelados_hoje ?? 0}</td></tr>
      <tr><td><b>Ruptura</b> — pedidos em que faltou item</td>
          <td style="text-align:right" class="mono"><b style="color:${(i.ruptura_pct ?? 0) > 15 ? 'var(--red)' : 'var(--save)'}">${i.ruptura_pct ?? 0}%</b></td></tr>
      <tr><td>SKUs com estoque zerado</td><td style="text-align:right" class="mono">${i.estoque_zerado ?? 0}</td></tr>
    </table></div>`;
}

/**
 * As ações das telas novas. Devolve true quando tratou o clique —
 * assim a cadeia de ifs do painel antigo continua intacta embaixo.
 */
function telasNovas(a, b, base, pid) {
  const campo = (raiz, n) => raiz?.querySelector(`[name="${n}"]`)?.value?.trim() ?? '';
  const centavos = (txt) => Math.round(parseFloat(String(txt).replace(/[^0-9,.-]/g, '').replace(',', '.')) * 100);

  if (a === 'fechar-cliente') { S.clienteAberto = null; S.cliente = null; carregar(); return true; }
  if (a === 'fechar-ean') { S.eanAberto = null; S.produtoAberto = null; carregar(); return true; }

  if (a === 'anotar') {
    const f = b.closest('.bloco-notas');
    const texto = campo(f, 'nota');
    if (!texto) { S.erro = 'Escreva a nota antes de salvar'; desenhar(); return true; }
    acao(() => api('POST', `${base}/clientes/${S.clienteAberto}/notas`,
      { texto, fixada: f.querySelector('[name="fixar"]').checked ? 1 : 0 }));
    return true;
  }
  if (a === 'marcar') {
    const m = prompt('Marca (uma palavra): acamado, uso contínuo, prédio sem elevador…');
    if (m) acao(() => api('POST', `${base}/clientes/${S.clienteAberto}/marcas`, { marca: m }));
    return true;
  }

  if (a === 'campanha-abrir') { S.campanhaAberta = true; S.ultimaCampanha = null; desenhar(); return true; }
  if (a === 'campanha-fechar') { S.campanhaAberta = false; desenhar(); return true; }
  if (a === 'campanha-enviar') {
    const f = b.closest('.bloco-campanha');
    const seg = campo(f, 'segmento'), titulo = campo(f, 'titulo'), corpo = campo(f, 'corpo');
    if (!titulo || !corpo) { S.erro = 'Campanha precisa de título e mensagem'; desenhar(); return true; }
    const quantos = seg === 'todos'
      ? S.segmentos.reduce((t, s) => t + s.clientes, 0)
      : S.segmentos.find((s) => s.segmento === seg)?.clientes ?? 0;
    if (!confirm(`Mandar "${titulo}" para ${quantos} pessoa(s)? Isso chega no celular delas.`)) return true;
    acao(async () => {
      S.ultimaCampanha = await api('POST', `${base}/campanhas`, { segmento: seg, titulo, corpo });
      S.campanhaAberta = false;
    });
    return true;
  }

  if (a === 'entrada-estoque') {
    const f = b.closest('.bloco-entrada');
    const ean = (campo(f, 'ean').match(/[0-9]{8,14}/) || [])[0];
    const qtd = Number(campo(f, 'qtd'));
    if (!ean || !qtd) { S.erro = 'Informe o produto e a quantidade'; desenhar(); return true; }
    const custoTxt = campo(f, 'custo');
    acao(async () => {
      const r = await api('POST', `${base}/estoque/entrada`, {
        ean, lote: campo(f, 'lote'), validade: campo(f, 'validade') || null, qtd,
        custo_centavos: custoTxt ? centavos(custoTxt) : null,
        fornecedor: campo(f, 'fornecedor') || null, nota_fiscal: campo(f, 'nota') || null,
      });
      const nome = S.catalogo.find((p) => p.ean === ean)?.nome ?? ean;
      S.ultimaEntrada = { ...r, qtd, nome, lote: campo(f, 'lote') };
    });
    return true;
  }

  if (a === 'contar') {
    const f = b.closest('.bloco-contagem');
    const n = campo(f, 'contagem');
    if (n === '') { S.erro = 'Digite quantas unidades você contou'; desenhar(); return true; }
    acao(() => api('POST', `${base}/estoque/contagem`,
      { ean: S.eanAberto, qtd_contada: Number(n), motivo: campo(f, 'motivo-contagem') }));
    return true;
  }

  if (a === 'baixar-perda') {
    const { lote, nome, qtd } = b.dataset;
    const quantos = prompt(`Quantas unidades de ${nome} você está baixando? (tem ${qtd})`, qtd);
    if (!quantos) return true;
    const motivo = prompt('Motivo da baixa: vencido, quebra, avaria…');
    if (!motivo) return true;
    acao(() => api('POST', `${base}/estoque/perda`, { lote_id: lote, qtd: Number(quantos), motivo }));
    return true;
  }

  if (a === 'salvar-piloto') {
    const f = b.closest('.bloco-frota');
    const v = (n) => f.querySelector(`[name="${n}"]`)?.value?.trim() ?? '';
    const marcado = (n) => !!f.querySelector(`[name="${n}"]`)?.checked;
    if (!v('nome')) { S.erro = 'O piloto precisa de nome'; desenhar(); return true; }
    acao(() => api('POST', `${base}/entregadores`, {
      nome: v('nome'), telefone: v('telefone'), veiculo: v('veiculo'),
      placa: v('placa'), cnh: v('cnh'), email: v('email'), senha: v('senha') || 'entrega123',
      caixa_termica: marcado('caixa_termica'), rastreavel: marcado('rastreavel'),
    }));
    return true;
  }
  if (a === 'rastreio' || a === 'piloto-ativo') {
    const c = S.frota.find((x) => x.id === b.dataset.id);
    if (!c) return true;
    // desligar o rastreio é decisão da loja, e vale dizer em voz alta o
    // que acontece: o cliente deixa de ver a moto naquele instante
    if (a === 'rastreio' && c.rastreavel
        && !confirm(`Desligar o rastreamento de ${c.nome}? O cliente deixa de ver a moto no mapa.`)) {
      return true;
    }
    acao(() => api('POST', `${base}/entregadores`, {
      ...c,
      rastreavel: a === 'rastreio' ? !c.rastreavel : c.rastreavel,
      ativo: a === 'piloto-ativo' ? !c.ativo : c.ativo,
    }));
    return true;
  }

  if (a === 'apagar-foto') {
    if (!confirm('Remover a foto deste produto?')) return true;
    acao(() => api('DELETE', `${base}/catalogo/${S.eanAberto}/foto`));
    return true;
  }
  return salvamentosDaLoja(a, b, base);
}

/** Os três salvamentos da tela da loja. Cada um bate numa rota diferente. */
function salvamentosDaLoja(a, b, base) {
  const val = (n) => document.querySelector(`.bloco-loja [name="${n}"]`)?.value?.trim() ?? '';
  const centavos = (txt) => Math.round(parseFloat(String(txt).replace(',', '.')) * 100) || 0;

  if (a === 'salvar-loja') {
    acao(() => api('PUT', base, {
      nome_fantasia: val('nome_fantasia'), telefone: val('telefone'), email: val('email'),
      logradouro: val('logradouro'), numero: val('numero'), bairro: val('bairro'),
      cidade: val('cidade'), uf: val('uf'), cep: val('cep'),
    }).then((f) => {
      // o nome no topo é o mesmo campo: muda aqui, muda no app do cliente
      S.loja = { ...S.loja, nome_fantasia: f.nome_fantasia };
      localStorage.setItem('sm_loja', JSON.stringify(S.loja));
    }));
    return true;
  }

  if (a === 'salvar-entrega') {
    const area = document.querySelector('[name="area"]').value
      .split('\n').map((s) => s.trim()).filter(Boolean);
    acao(async () => {
      await api('PUT', base, {
        frete_centavos: centavos(val('frete_centavos')),
        frete_gratis_acima_centavos: centavos(val('frete_gratis_acima_centavos')),
        raio_entrega_m: Number(val('raio_entrega_m')) || 6000,
      });
      await api('PUT', `${base}/area`, { area });
    });
    return true;
  }

  if (a === 'salvar-horarios') {
    const dias = [...document.querySelectorAll('.dia')].map((d) => ({
      dia_semana: Number(d.dataset.dia),
      abre: d.querySelector('[name="abre"]').value || null,
      fecha: d.querySelector('[name="fecha"]').value || null,
      is_24h: d.querySelector('[name="is_24h"]').checked,
      fechado: d.querySelector('[name="fechado"]').checked,
    }));
    acao(() => api('PUT', `${base}/horarios`, { dias }));
    return true;
  }

  if (a === 'salvar-config') {
    acao(() => api('PUT', '/api/admin/config', {
      receita_habilitada: document.querySelector('[name="receita_habilitada"]').checked,
      pix_habilitado: document.querySelector('[name="pix_habilitado"]').checked,
      pix_chave: document.querySelector('[name="pix_chave"]').value.trim(),
    }));
    return true;
  }
  return false;
}

/**
 * Um listener só, delegado, ligado uma vez.
 *
 * Já foi ligado a cada desenho uma vez nesta vida: um toque disparava
 * quatro vezes. Não de novo.
 */
function ligaCliques() {
  $('#raiz').addEventListener('click', (e) => {
    const pid = S.loja.pharmacy_id;
    const base = `/api/comercio/${pid}`;

    // navegação lateral dentro das telas novas
    const alvoCli = e.target.closest('[data-cliente]');
    if (alvoCli) { S.clienteAberto = alvoCli.dataset.cliente; S.aba = 'clientes'; return carregar(); }
    const alvoSeg = e.target.closest('[data-segmento]');
    if (alvoSeg) {
      S.segmento = alvoSeg.dataset.segmento; S.aba = 'clientes';
      S.clienteAberto = null; return carregar();
    }
    const alvoEan = e.target.closest('[data-ean]');
    if (alvoEan) { S.eanAberto = alvoEan.dataset.ean; S.aba = 'estoque'; return carregar(); }
    const alvoAbaEst = e.target.closest('[data-aba-estoque]');
    if (alvoAbaEst) { S.abaEstoque = alvoAbaEst.dataset.abaEstoque; return carregar(); }
    const alvoFiltro = e.target.closest('[data-filtro-estoque]');
    if (alvoFiltro) { S.filtroEstoque = alvoFiltro.dataset.filtroEstoque; return carregar(); }
    const alvoNota = e.target.closest('[data-apagar-nota]');
    if (alvoNota) return acao(() => api('DELETE', `${base}/clientes/notas/${alvoNota.dataset.apagarNota}`));
    const alvoMarca = e.target.closest('[data-desmarcar]');
    if (alvoMarca) {
      return acao(() => api('POST', `${base}/clientes/${S.clienteAberto}/marcas`,
        { marca: alvoMarca.dataset.desmarcar, ligar: false }));
    }

    const b = e.target.closest('[data-acao]'); if (!b) return;
    const { acao: a, oid, item, rid } = b.dataset;
    if (telasNovas(a, b, base, pid)) return;

    if (a === 'aceitar')   acao(() => api('POST', `${base}/pedidos/${oid}/aceitar`));
    if (a === 'recusar')   { const m = prompt('Por que está recusando?'); if (m) acao(() => api('POST', `${base}/pedidos/${oid}/recusar`, { motivo: m })); }
    if (a === 'falta')     acao(() => api('POST', `${base}/pedidos/${oid}/itens/${item}/indisponivel`));
    if (a === 'trocar')    { const ean = prompt('EAN do produto que você vai oferecer no lugar:'); if (ean) acao(() => api('POST', `${base}/pedidos/${oid}/itens/${item}/substituir`, { ean })); }
    if (a === 'pronto')    acao(() => api('POST', `${base}/pedidos/${oid}/pronto`, { conferencia: [] }));
    if (a === 'despachar') acao(() => api('POST', `${base}/pedidos/${oid}/despachar`, {}));
    if (a === 'liberar')   acao(() => api('POST', `${base}/receitas/${rid}/liberar`));
    if (a === 'preencher') { const f = b.closest('.cartao-receita'); acao(() => api('POST', `${base}/receitas/${rid}/preencher`, lerPreenchimento(f))); }
    if (a === 'reter')     { const f = b.closest('.cartao-retencao'); acao(() => api('POST', `${base}/receitas/${rid}/retencao`, lerRetencao(f))); }
    if (a === 'responder') {
      const f = b.closest('.cartao-conversa');
      const t = f.querySelector('[name="resposta"]').value.trim();
      if (t) acao(() => api('POST', `${base}/conversas/${b.dataset.cid}/responder`, { texto: t }));
    }
    if (a === 'fechar-conversa') acao(() => api('POST', `${base}/conversas/${b.dataset.cid}/fechar`));
    if (a === 'recolher') {
      const f = b.closest('.bloco-recall');
      const v = (n) => f.querySelector(`[name="${n}"]`)?.value?.trim() || '';
      const ean = (v('ean').match(/[0-9]{8,14}/) || [v('ean')])[0];
      if (!ean || v('motivo').length < 5) { S.erro = 'Informe o EAN e o motivo do recolhimento'; return desenhar(); }
      if (!confirm(`Recolher o lote ${v('lote') || '(todos)'}? Quem levou vai ser avisado agora.`)) return;
      acao(async () => {
        const r = await api('POST', `${base}/recalls`, { ean, lote: v('lote') || null,
          motivo: v('motivo'), origem: v('origem') || 'anvisa', referencia: v('ref') || null });
        S.ultimoRecall = r;
      });
    }
    if (a === 'negar')     { const m = prompt('Motivo da recusa (o cliente vai ler):'); if (m) acao(() => api('POST', `${base}/receitas/${rid}/recusar`, { motivo: m })); }
  });
}

// ---------- tempo real ----------
let fonte = null, tique = null;
function iniciar() {
  if (!iniciar.ligado) { ligaCliques(); iniciar.ligado = true; }
  carregar();
  fonte?.close();
  fonte = new EventSource(`${API}/api/comercio/${S.loja.pharmacy_id}/stream`);
  fonte.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (d.tipo === 'pedido_novo') {
      try { new AudioContext().resume(); } catch {}
      apitar();
    }
    if (d.tipo !== 'conectado') carregar();
  };
  clearInterval(tique);
  tique = setInterval(() => { if (S.aba === 'pedidos' && S.pedidos.some((p) => p.status === 'aguardando_loja')) desenhar(); }, 1000);
}

/** O som do pedido novo é requisito de produto, não detalhe. */
function apitar() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18].forEach((t, n) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = n ? 1046 : 784;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.16);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.18);
    });
  } catch {}
}

if (S.token && S.loja) {
  api('GET', '/api/auth/eu').then((eu) => {
    if (!eu.lojas?.length) return telaLogin();
    S.loja = eu.lojas.find((l) => l.pharmacy_id === S.loja.pharmacy_id) || eu.lojas[0];
    S.eu = eu; iniciar();
  }).catch(() => telaLogin());
} else telaLogin();
