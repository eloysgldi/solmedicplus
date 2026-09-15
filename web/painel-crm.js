import { esc, brl, curto, quando, dataBR, iniciais, corDoNome } from './painel-ui.js';
import { ROTULO_SEG } from './painel-visao.js';

/**
 * ============================================================
 * CLIENTES
 *
 * O CRM de farmácia não é o CRM de e-commerce. O que importa aqui não é
 * "quanto gastou": é *quando deveria ter voltado*, o que tem em casa
 * agora, e o que a equipe precisa lembrar antes de bater na porta.
 *
 * Por isso a ficha abre com o armário e com as notas da equipe, e o
 * histórico de compras vem depois.
 * ============================================================
 */

const ORDENS = [['recentes', 'mais recentes'], ['valor', 'quem gasta mais'],
  ['frequencia', 'quem compra mais'], ['sumidos', 'quem sumiu'], ['nome', 'nome']];

export function telaClientes(ctx) {
  const { S } = ctx;
  if (S.clienteAberto) return ficha(ctx);

  const segs = S.segmentos ?? [];
  const total = segs.reduce((t, s) => t + s.clientes, 0);

  return `
  <h1>Clientes</h1>
  <p class="sub">${total} pessoa(s) já compraram aqui. A régua é o ritmo de cada uma —
    quem some de um remédio de uso contínuo é problema clínico antes de ser problema de venda.</p>

  <div class="faixa-segmentos solta">
    <button class="seg-bloco ${!S.segmento ? 'on' : ''}" data-segmento="">
      <b>${total}</b><span>todos</span><i>&nbsp;</i></button>
    ${segs.filter((s) => s.clientes).map((s) => `
      <button class="seg-bloco ${s.segmento} ${S.segmento === s.segmento ? 'on' : ''}"
        data-segmento="${s.segmento}">
        <b>${s.clientes}</b><span>${ROTULO_SEG[s.segmento] ?? s.segmento}</span>
        <i>${curto(s.valor_centavos)}</i></button>`).join('')}
  </div>

  <div class="card">
    <header>
      <input class="ent" id="busca-cliente" placeholder="Nome, e-mail ou telefone"
        value="${esc(S.buscaCliente ?? '')}" style="flex:1;min-width:200px">
      <select class="ent" id="ordem-cliente" style="width:170px">
        ${ORDENS.map(([k, t]) => `<option value="${k}" ${S.ordemCliente === k ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <button class="btn g sm" data-acao="campanha-abrir">Avisar um grupo</button>
    </header>

    ${S.campanhaAberta ? blocoCampanha(S) : ''}

    ${!S.campanhaAberta && S.ultimaCampanha ? `
      <div class="ok" style="margin:14px 16px 0">
        ✓ "${esc(S.ultimaCampanha.titulo)}" saiu para
        <b>${S.ultimaCampanha.alcance} pessoa(s)</b> do segmento
        ${ROTULO_SEG[S.ultimaCampanha.segmento] ?? S.ultimaCampanha.segmento}.</div>` : ''}

    ${(S.clientes ?? []).length ? `
      <table class="tabela-clientes">
        <tr><th>cliente</th><th>segmento</th><th style="text-align:right">pedidos</th>
            <th style="text-align:right">gasto</th><th style="text-align:right">ticket</th>
            <th>última compra</th></tr>
        ${S.clientes.map(linha).join('')}
      </table>`
      : '<div class="vazio">Ninguém aqui com esse filtro.</div>'}
  </div>`;
}

function linha(c) {
  return `
  <tr class="clicavel" data-cliente="${esc(c.id)}">
    <td>
      <span class="pessoa">
        <span class="av" style="background:${corDoNome(c.nome)}">${iniciais(c.nome)}</span>
        <span class="tx"><b>${esc(c.nome)}</b>
          <span>${esc(c.telefone ?? c.email)}</span></span>
      </span>
      ${c.marcas?.length ? `<span class="marcas">${c.marcas.map((m) =>
        `<span class="marca-cli">${esc(m)}</span>`).join('')}</span>` : ''}
    </td>
    <td><span class="pill seg ${c.segmento}">${ROTULO_SEG[c.segmento] ?? c.segmento}</span>
      ${c.socio ? '<span class="pill socio">sócio</span>' : ''}
      ${c.recompra_atrasada ? '<span class="pill critico">atrasado</span>' : ''}</td>
    <td style="text-align:right" class="mono">${c.pedidos}</td>
    <td style="text-align:right" class="mono"><b>${brl(c.gasto_centavos)}</b></td>
    <td style="text-align:right" class="mono">${brl(c.ticket_centavos)}</td>
    <td>${quando(c.ultima_em)}
      ${c.intervalo_medio_dias ? `<br><span class="fino">costuma voltar a cada ${c.intervalo_medio_dias}d</span>` : ''}</td>
  </tr>`;
}

/**
 * Campanha por segmento.
 *
 * É uma arma apontada para a base inteira, então a tela mostra o alcance
 * antes de deixar disparar e avisa, em texto, que nome de medicamento não
 * entra: a notificação acende na tela de bloqueio na frente de qualquer um.
 */
function blocoCampanha(S) {
  const seg = S.campanhaSeg ?? 'todos';
  const alvo = seg === 'todos'
    ? (S.segmentos ?? []).reduce((t, s) => t + s.clientes, 0)
    : (S.segmentos ?? []).find((s) => s.segmento === seg)?.clientes ?? 0;

  return `
  <div class="bloco-campanha">
    <div class="linha" style="gap:8px;flex-wrap:wrap">
      <select class="ent" name="segmento" style="width:170px">
        <option value="todos" ${seg === 'todos' ? 'selected' : ''}>todos os clientes</option>
        ${Object.entries(ROTULO_SEG).map(([k, t]) =>
          `<option value="${k}" ${seg === k ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <input class="ent" name="titulo" placeholder="Título — aparece em negrito"
        style="flex:1;min-width:180px" maxlength="60">
    </div>
    <input class="ent" name="corpo" placeholder="Mensagem — sem nome de medicamento"
      style="width:100%;margin-top:8px" maxlength="140">
    <div class="linha" style="margin-top:10px;gap:10px;flex-wrap:wrap">
      <button class="btn p sm" data-acao="campanha-enviar">Enviar para ${alvo} pessoa(s)</button>
      <button class="btn g sm" data-acao="campanha-fechar">Cancelar</button>
      <span class="fino">Fica registrado quem disparou, para quem e quando.</span>
    </div>
  </div>`;
}

/* ============================================================
   A FICHA
   ============================================================ */

function ficha(ctx) {
  const { S } = ctx;
  const f = S.cliente;
  if (!f) return `<h1>Cliente</h1><div class="card"><div class="vazio">Carregando…</div></div>`;
  const c = f.cliente;

  return `
  <div class="volta-linha">
    <button class="btn g sm" data-acao="fechar-cliente">← Clientes</button>
  </div>

  <div class="cabeca-cliente">
    <span class="av grande" style="background:${corDoNome(c.nome)}">${iniciais(c.nome)}</span>
    <div class="tx">
      <h1>${esc(c.nome)}</h1>
      <p class="sub">${esc(c.telefone ?? '—')} · ${esc(c.email)}
        ${c.socio ? ' · <b>sócio do clube</b>' : ''}</p>
      <div class="marcas">
        <span class="pill seg ${c.segmento}">${ROTULO_SEG[c.segmento] ?? c.segmento}</span>
        ${f.marcas.map((m) => `<button class="marca-cli" data-desmarcar="${esc(m)}">${esc(m)} ×</button>`).join('')}
        <button class="marca-cli nova" data-acao="marcar">+ marca</button>
      </div>
    </div>
    <div class="numeros">
      ${[['pedidos', c.pedidos], ['gasto', brl(c.gasto_centavos)],
         ['ticket', brl(c.ticket_centavos)],
         ['última compra', quando(c.ultima_em)],
         ['ritmo', c.intervalo_medio_dias ? `${c.intervalo_medio_dias} dias` : '—'],
         ['nota', f.nota_media ?? '—']]
        .map(([k, v]) => `<div class="mini"><span>${k}</span><b>${v}</b></div>`).join('')}
    </div>
  </div>

  ${c.recompra_atrasada ? `
    <div class="faixa-atencao">
      <b>Passou da hora de voltar.</b> O ritmo é de ${c.intervalo_medio_dias} dias e já são
      ${c.dias_sem_comprar}. Se for uso contínuo, o tratamento pode ter parado.
    </div>` : ''}

  <div class="duas-colunas">
    ${blocoArmario(f)}
    ${blocoNotas(f)}
  </div>

  <div class="duas-colunas">
    ${blocoCompras(f)}
    ${blocoLateral(f)}
  </div>`;
}

/**
 * O armário na ficha do cliente.
 *
 * É o campo que nenhum CRM de varejo tem: o que a pessoa tem em casa
 * agora, com lote e validade. Serve para não empurrar o que ela já tem
 * e para saber do que a pessoa vai precisar antes dela.
 */
function blocoArmario(f) {
  const itens = f.armario ?? [];
  return `
  <div class="card">
    <header><div><div class="cod">em casa</div><div class="nm">O que tem em casa</div></div>
      <span class="pill">${itens.length} item(ns)</span></header>
    ${itens.length ? itens.map((i) => `
      <div class="linha-risco">
        <span class="tj ${i.estado === 'recolhido' || i.estado === 'vencido' ? 'vermelho'
          : i.estado === 'vencendo' ? 'ambar' : ''}"></span>
        <span class="quem"><b>${esc(i.nome)}</b>
          <span>${i.qtd_atual} un${i.lote ? ` · lote ${esc(i.lote)}` : ''}${
            i.validade ? ` · vence ${dataBR(i.validade)}` : ''}</span></span>
        ${i.estado === 'recolhido' ? '<span class="pill vencido">recolhido</span>'
          : i.estado === 'vencido' ? '<span class="pill vencido">vencido</span>'
          : i.estado === 'vencendo' ? `<span class="pill critico">${i.dias_para_vencer}d</span>` : ''}
      </div>`).join('')
      : '<div class="vazio">Nada registrado — as entregas são anteriores ao armário.</div>'}
  </div>`;
}

/** O recado que a equipe deixa para a equipe. Fixado aparece na separação. */
function blocoNotas(f) {
  return `
  <div class="card bloco-notas">
    <header><div><div class="cod">equipe</div><div class="nm">Notas internas</div></div></header>
    <div style="padding:14px 16px">
      <div class="linha" style="gap:8px">
        <input class="ent" name="nota" placeholder="O que a próxima pessoa precisa saber"
          style="flex:1" maxlength="200">
        <label class="fixar"><input type="checkbox" name="fixar"> fixar no pedido</label>
        <button class="btn p sm" data-acao="anotar">Salvar</button>
      </div>
      ${f.notas.length ? `<div class="notas">${f.notas.map((n) => `
        <div class="nota ${n.fixada ? 'fixada' : ''}">
          <p>${n.fixada ? '📌 ' : ''}${esc(n.texto)}</p>
          <span>${esc(n.autor ?? 'equipe')} · ${dataBR(n.criado_em)}
            <button class="apagar" data-apagar-nota="${esc(n.id)}">apagar</button></span>
        </div>`).join('')}</div>`
        : '<p class="fino" style="margin:14px 0 0">Nenhuma nota ainda.</p>'}
    </div>
  </div>`;
}

function blocoCompras(f) {
  return `
  <div class="card">
    <header><div><div class="cod">histórico</div><div class="nm">Compras</div></div>
      <span class="pill">${f.pedidos.length} listados</span></header>
    ${f.pedidos.length ? `<table>
      <tr><th>pedido</th><th>quando</th><th style="text-align:right">itens</th>
          <th style="text-align:right">total</th><th>situação</th></tr>
      ${f.pedidos.map((p) => `
        <tr><td class="mono">${esc(p.codigo)}</td>
          <td>${dataBR(p.criado_em)}</td>
          <td style="text-align:right" class="mono">${p.itens}</td>
          <td style="text-align:right" class="mono">${brl(p.total_centavos)}</td>
          <td><span class="pill ${p.status}">${esc(p.status.replace(/_/g, ' '))}</span></td></tr>`).join('')}
    </table>` : '<div class="vazio">Sem compras registradas.</div>'}
  </div>`;
}

function blocoLateral(f) {
  return `
  <div>
    <div class="card">
      <header><div><div class="cod">o que leva sempre</div><div class="nm">Recorrentes</div></div></header>
      ${f.favoritos.length ? f.favoritos.map((p) => `
        <div class="linha-risco">
          <span class="quem"><b>${esc(p.nome)}</b>
            <span>${p.vezes}× · ${p.unidades} un · ${quando(p.ultima_em)}</span></span>
        </div>`).join('') : '<div class="vazio">Sem padrão ainda.</div>'}
    </div>

    <div class="card">
      <header><div><div class="cod">entrega</div><div class="nm">Endereços</div></div></header>
      ${f.enderecos.map((e) => `
        <div class="linha-risco">
          <span class="quem"><b>${esc(e.apelido ?? 'Endereço')}${e.padrao ? ' · padrão' : ''}</b>
            <span>${esc(e.logradouro)}, ${esc(e.numero ?? 's/n')} — ${esc(e.bairro)}</span></span>
        </div>`).join('') || '<div class="vazio">Sem endereço.</div>'}
    </div>

    ${f.receitas.length ? `
    <div class="card">
      <header><div><div class="cod">farmacêutico</div><div class="nm">Receitas</div></div></header>
      ${f.receitas.map((r) => `
        <div class="linha-risco">
          <span class="quem"><b>${esc(r.prescritor_nome ?? 'Prescritor não informado')}</b>
            <span>${esc(r.status)} · emitida ${dataBR(r.emitida_em)}${
              r.valida_ate ? ` · vale até ${dataBR(r.valida_ate)}` : ''}</span></span>
        </div>`).join('')}
    </div>` : ''}
  </div>`;
}
