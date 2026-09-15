import { esc, brl, curto, dataBR, quando, barra, seloValidade } from './painel-ui.js';

/**
 * ============================================================
 * ESTOQUE
 *
 * Três perguntas, nesta ordem, porque é nesta ordem que o dinheiro some:
 *
 *   1. o que vai faltar          → venda perdida
 *   2. o que vai vencer          → prejuízo puro, já foi pago
 *   3. o que está parado         → capital dormindo na prateleira
 *
 * Tudo que mexe no saldo escreve no kardex. Não existe "sumiu": existe
 * movimento com motivo e nome de quem fez.
 * ============================================================
 */

const ABAS = [['posicao', 'Posição'], ['entrada', 'Entrada'], ['vencendo', 'Validade'],
  ['abc', 'Curva ABC'], ['conferencia', 'Divergências']];

const FILTROS = [['todos', 'tudo'], ['zerado', 'zerados'], ['acabando', 'acabando'],
  ['vencendo', 'vencendo'], ['parados', 'parados'], ['divergente', 'divergentes']];

export function telaEstoque(ctx) {
  const { S } = ctx;
  if (S.eanAberto) return fichaProduto(ctx);
  const r = S.estoqueResumo ?? {};

  return `
  <h1>Estoque</h1>
  <p class="sub">Saldo, lote, validade e custo — e o extrato de tudo que entrou e saiu.</p>

  <div class="grade-kpi">
    ${[
      ['valor a custo', curto(r.valor_custo_centavos), `${r.unidades ?? 0} unidades`],
      ['valor a venda', curto(r.valor_venda_centavos),
        r.valor_custo_centavos ? `margem embutida ${(((r.valor_venda_centavos - r.valor_custo_centavos) / r.valor_venda_centavos) * 100).toFixed(0)}%` : ''],
      ['zerados', r.zerados ?? 0, 'venda perdida agora'],
      ['acabando', r.acabando ?? 0, 'menos de 5 dias de cobertura'],
      ['vencendo em 90d', r.vencendo_90d ?? 0, 'prejuízo se não girar'],
      ['perdas do mês', curto(r.perdas_mes_centavos), `${r.perdas_mes_unidades ?? 0} unidades baixadas`],
    ].map(([k, v, pe]) => `<div class="kpi-card"><div class="k">${k}</div>
      <div class="v">${v}</div><div class="pe">${pe ?? ''}</div></div>`).join('')}
  </div>

  <div class="abas-linha">
    ${ABAS.map(([k, t]) => `<button class="aba-est ${S.abaEstoque === k ? 'on' : ''}"
      data-aba-estoque="${k}">${t}</button>`).join('')}
  </div>

  ${S.abaEstoque === 'entrada' ? telaEntrada(ctx)
    : S.abaEstoque === 'vencendo' ? telaVencendo(ctx)
    : S.abaEstoque === 'abc' ? telaABC(ctx)
    : S.abaEstoque === 'conferencia' ? telaConferencia(ctx)
    : telaPosicao(ctx)}`;
}

function telaPosicao({ S }) {
  const itens = S.estoque ?? [];
  return `
  <div class="card">
    <header>
      <input class="ent" id="busca-estoque" placeholder="Produto ou EAN"
        value="${esc(S.buscaEstoque ?? '')}" style="flex:1;min-width:200px">
      <span class="filtros">${FILTROS.map(([k, t]) => `
        <button class="chip ${S.filtroEstoque === k ? 'on' : ''}" data-filtro-estoque="${k}">${t}</button>`).join('')}</span>
    </header>
    ${itens.length ? `<table class="tabela-estoque">
      <tr><th>produto</th><th>posição</th><th style="text-align:right">saldo</th>
          <th style="text-align:right">reservado</th><th style="text-align:right">gira</th>
          <th style="text-align:right">cobertura</th><th>vence</th>
          <th style="text-align:right">custo</th><th style="text-align:right">margem</th></tr>
      ${itens.map((i) => `
        <tr class="clicavel ${i.alerta ?? ''}" data-ean="${esc(i.ean)}">
          <td><span class="pessoa">
            ${i.imagem_url ? `<img class="mini-foto" src="${esc(i.imagem_url)}" alt="">`
              : '<span class="mini-foto vazia"></span>'}
            <span class="tx"><b>${esc(i.nome)}</b>
              <span>${esc(i.apresentacao ?? '')}${i.lotes_abertos ? ` · ${i.lotes_abertos} lote(s)` : ''}</span></span>
          </span></td>
          <td><span class="posicao">${esc(i.posicao ?? '—')}</span></td>
          <td style="text-align:right" class="mono">
            <b class="${i.estoque <= 0 ? 'zero' : ''}">${i.estoque}</b>
            ${i.divergente ? `<span class="fino">lotes: ${i.em_lotes}</span>` : ''}</td>
          <td style="text-align:right" class="mono">${i.estoque_reservado || '—'}</td>
          <td style="text-align:right" class="mono">${i.por_dia || '—'}</td>
          <td style="text-align:right" class="mono">${i.cobertura_dias === null ? '—'
            : `<b class="${i.cobertura_dias <= 5 ? 'zero' : ''}">${i.cobertura_dias}d</b>`}</td>
          <td>${i.vence_primeiro ? seloValidade(i.dias_para_vencer) : '—'}</td>
          <td style="text-align:right" class="mono">${i.custo_centavos ? brl(i.custo_centavos) : '—'}</td>
          <td style="text-align:right" class="mono">${i.margem_pct !== null ? i.margem_pct + '%' : '—'}</td>
        </tr>`).join('')}
    </table>` : '<div class="vazio">Nada com esse filtro.</div>'}
  </div>`;
}

/**
 * Recebimento de nota.
 *
 * É a porta onde lote e validade entram no sistema uma vez só — em vez
 * de serem digitados a cada separação, que é onde todo controle de lote
 * de farmácia morre na prática.
 */
function telaEntrada({ S }) {
  return `
  <div class="card bloco-entrada">
    <header><div><div class="cod">recebimento</div><div class="nm">Entrada de nota</div></div></header>
    <div style="padding:16px">
      <div class="linha" style="gap:8px;flex-wrap:wrap">
        <input class="ent" name="ean" list="catalogo-loja" placeholder="EAN ou produto"
          style="flex:2;min-width:200px">
        <input class="ent" name="lote" placeholder="Lote" style="width:130px">
        <input class="ent" name="validade" type="date" style="width:150px">
        <input class="ent" name="qtd" type="number" min="1" placeholder="Qtd" style="width:90px">
      </div>
      <div class="linha" style="gap:8px;flex-wrap:wrap;margin-top:8px">
        <input class="ent" name="custo" placeholder="Custo unitário (R$)" style="width:160px">
        <input class="ent" name="fornecedor" placeholder="Fornecedor" style="flex:1;min-width:160px">
        <input class="ent" name="nota" placeholder="Nº da nota" style="width:130px">
        <button class="btn p" data-acao="entrada-estoque">Dar entrada</button>
      </div>
      ${S.ultimaEntrada ? `<div class="ok" style="margin-top:14px">
        ✓ ${S.ultimaEntrada.qtd} un de ${esc(S.ultimaEntrada.nome)} no lote
        ${esc(S.ultimaEntrada.lote)} — saldo agora: <b>${S.ultimaEntrada.saldo}</b></div>` : ''}
      <p class="fino" style="margin:14px 0 0;line-height:1.55">
        O lote que entra aqui é o que o sistema vai escolher sozinho na separação,
        pela regra FEFO — vence primeiro, sai primeiro. O balconista só confirma.
      </p>
    </div>
  </div>

  <div class="card">
    <header><div><div class="cod">últimos movimentos</div>
      <div class="nm">O que entrou e saiu</div></div></header>
    ${(S.movimentos ?? []).length ? `<table>
      <tr><th>quando</th><th>produto</th><th>tipo</th><th>motivo</th>
          <th style="text-align:right">qtd</th><th style="text-align:right">saldo</th><th>quem</th></tr>
      ${S.movimentos.map((m) => `
        <tr><td class="mono">${dataBR(m.criado_em)}</td>
          <td><b>${esc(m.nome ?? m.ean)}</b>${m.lote ? `<br><span class="fino">lote ${esc(m.lote)}</span>` : ''}</td>
          <td><span class="pill mov ${m.tipo}">${esc(m.tipo)}</span></td>
          <td>${esc(m.motivo ?? '—')}${m.codigo ? ` · ${esc(m.codigo)}` : ''}</td>
          <td style="text-align:right" class="mono ${m.qtd < 0 ? 'zero' : 'positivo'}">
            ${m.qtd > 0 ? '+' : ''}${m.qtd}</td>
          <td style="text-align:right" class="mono">${m.saldo_depois}</td>
          <td>${esc(m.quem ?? 'sistema')}</td></tr>`).join('')}
    </table>` : '<div class="vazio">Nenhum movimento ainda.</div>'}
  </div>`;
}

/** O que vence antes de vender. Aqui perda é prejuízo puro: já foi pago. */
function telaVencendo({ S }) {
  const lotes = S.vencendo ?? [];
  const parado = lotes.reduce((t, l) => t + l.parado_centavos, 0);
  return `
  <div class="card">
    <header><div><div class="cod">validade</div><div class="nm">Vence nos próximos 90 dias</div></div>
      <span class="pill critico">${curto(parado)} em risco</span></header>
    ${lotes.length ? `<table>
      <tr><th>produto</th><th>lote</th><th>validade</th><th style="text-align:right">qtd</th>
          <th style="text-align:right">custo parado</th><th>fornecedor</th><th></th></tr>
      ${lotes.map((l) => `
        <tr class="${l.vencido ? 'zerado' : ''}">
          <td><b>${esc(l.nome)}</b><br><span class="fino">${esc(l.apresentacao ?? '')}</span></td>
          <td class="mono">${esc(l.lote)}</td>
          <td>${seloValidade(l.dias_para_vencer)}<br><span class="fino">${dataBR(l.validade)}</span></td>
          <td style="text-align:right" class="mono">${l.qtd}</td>
          <td style="text-align:right" class="mono">${brl(l.parado_centavos)}</td>
          <td>${esc(l.fornecedor ?? '—')}</td>
          <td style="text-align:right">
            <button class="btn d sm" data-acao="baixar-perda" data-lote="${esc(l.id)}"
              data-nome="${esc(l.nome)}" data-qtd="${l.qtd}">baixar</button></td>
        </tr>`).join('')}
    </table>` : '<div class="vazio">Nada vencendo nos próximos 90 dias.</div>'}
  </div>`;
}

/**
 * Curva ABC.
 *
 * A é a lista do que nunca pode faltar: 20% dos itens que fazem 80% do
 * dinheiro. C é onde mora o capital parado que ninguém percebe.
 */
function telaABC({ S }) {
  const l = S.abc ?? [];
  const conta = (c) => l.filter((i) => i.curva === c).length;
  return `
  <div class="card">
    <header><div><div class="cod">90 dias</div><div class="nm">Curva ABC por faturamento</div></div>
      <span class="pill curva-A">A: ${conta('A')}</span>
      <span class="pill curva-B">B: ${conta('B')}</span>
      <span class="pill curva-C">C: ${conta('C')}</span></header>
    ${l.length ? `<table>
      <tr><th>#</th><th>produto</th><th style="text-align:right">unidades</th>
          <th style="text-align:right">faturou</th><th>participação</th><th>curva</th></tr>
      ${l.map((i, k) => `
        <tr><td class="mono">${k + 1}</td>
          <td><b>${esc(i.nome)}</b></td>
          <td style="text-align:right" class="mono">${i.unidades}</td>
          <td style="text-align:right" class="mono">${brl(i.receita_centavos)}</td>
          <td style="min-width:150px">${barra(i.participacao_pct * 3,
            i.curva === 'A' ? 'var(--save)' : i.curva === 'B' ? 'var(--amber-solid)' : 'var(--line-2)')}
            <span class="fino">${i.participacao_pct}%</span></td>
          <td><span class="pill curva-${i.curva}">${i.curva}</span></td></tr>`).join('')}
    </table>` : '<div class="vazio">Sem vendas nos últimos 90 dias.</div>'}
  </div>`;
}

/**
 * Divergência entre o saldo do sistema e a soma dos lotes.
 *
 * Isto aqui é o detector de furo: se as duas contas não batem, ou alguém
 * mexeu na prateleira sem registrar, ou uma entrada foi digitada errado.
 */
function telaConferencia({ S }) {
  const d = S.conferencia ?? [];
  return `
  <div class="card">
    <header><div><div class="cod">auditoria</div><div class="nm">Saldo × lotes</div></div>
      <span class="pill ${d.length ? 'critico' : ''}">${d.length} divergência(s)</span></header>
    ${d.length ? `<table>
      <tr><th>produto</th><th style="text-align:right">sistema</th>
          <th style="text-align:right">soma dos lotes</th><th style="text-align:right">diferença</th><th></th></tr>
      ${d.map((i) => `
        <tr><td><b>${esc(i.nome)}</b><br><span class="fino mono">${esc(i.ean)}</span></td>
          <td style="text-align:right" class="mono">${i.sistema}</td>
          <td style="text-align:right" class="mono">${i.em_lotes}</td>
          <td style="text-align:right" class="mono zero"><b>${i.diferenca > 0 ? '+' : ''}${i.diferenca}</b></td>
          <td style="text-align:right"><button class="btn g sm" data-ean="${esc(i.ean)}">abrir</button></td>
        </tr>`).join('')}
    </table>` : `<div class="vazio">Saldo e lotes batendo em todos os produtos.</div>`}
  </div>`;
}

/* ============================================================
   A FICHA DO PRODUTO — onde estoque, foto, lote e extrato se encontram
   ============================================================ */

function fichaProduto({ S }) {
  const p = (S.estoque ?? []).find((i) => i.ean === S.eanAberto) ?? S.produtoAberto;
  if (!p) return `<div class="card"><div class="vazio">Carregando…</div></div>`;

  return `
  <div class="volta-linha"><button class="btn g sm" data-acao="fechar-ean">← Estoque</button></div>

  <div class="cabeca-produto">
    <div class="foto-grande">
      ${p.imagem_url ? `<img src="${esc(p.imagem_url)}" alt="">`
        : '<span class="sem-foto-painel">sem foto</span>'}
      <label class="trocar-foto">
        ${p.imagem_url ? 'trocar foto' : 'subir foto'}
        <input type="file" accept="image/jpeg,image/png,image/webp" data-foto="${esc(p.ean)}" hidden>
      </label>
      ${p.imagem_url ? `<button class="tirar-foto" data-acao="apagar-foto">remover</button>` : ''}
    </div>
    <div class="tx">
      <h1>${esc(p.nome)}</h1>
      <p class="sub">${esc([p.dosagem, p.apresentacao, p.fabricante].filter(Boolean).join(' · '))}
        <br><span class="mono fino">${esc(p.ean)}</span></p>
      <div class="numeros">
        ${[['saldo', p.estoque], ['reservado', p.estoque_reservado ?? 0],
           ['sai por dia', p.por_dia ?? 0],
           ['cobertura', p.cobertura_dias === null ? '—' : p.cobertura_dias + 'd'],
           ['custo', p.custo_centavos ? brl(p.custo_centavos) : '—'],
           ['preço', brl(p.preco_centavos)],
           ['margem', p.margem_pct !== null && p.margem_pct !== undefined ? p.margem_pct + '%' : '—']]
          .map(([k, v]) => `<div class="mini"><span>${k}</span><b>${v}</b></div>`).join('')}
      </div>
    </div>
  </div>

  <div class="duas-colunas">
    <div class="card bloco-contagem">
      <header><div><div class="cod">prateleira</div><div class="nm">Lotes</div></div></header>
      ${(S.lotes ?? []).length ? `<table>
        <tr><th>lote</th><th>validade</th><th style="text-align:right">qtd</th>
            <th style="text-align:right">custo</th><th>entrada</th><th></th></tr>
        ${S.lotes.map((l) => `
          <tr class="${l.bloqueado ? 'zerado' : ''}">
            <td class="mono"><b>${esc(l.lote)}</b>${l.bloqueado ? '<br><span class="fino">recolhido</span>' : ''}</td>
            <td>${seloValidade(l.dias_para_vencer)}</td>
            <td style="text-align:right" class="mono">${l.qtd}</td>
            <td style="text-align:right" class="mono">${l.custo_centavos ? brl(l.custo_centavos) : '—'}</td>
            <td>${dataBR(l.entrada_em)}<br><span class="fino">${esc(l.fornecedor ?? '')}</span></td>
            <td style="text-align:right">${l.qtd > 0 ? `
              <button class="btn d sm" data-acao="baixar-perda" data-lote="${esc(l.id)}"
                data-nome="${esc(p.nome)}" data-qtd="${l.qtd}">perda</button>` : ''}</td>
          </tr>`).join('')}
      </table>` : '<div class="vazio">Sem lote cadastrado — o saldo veio do catálogo.</div>'}
      <div class="rodape">
        <span class="fino">Contagem de prateleira</span>
        <input class="ent" name="contagem" type="number" min="0" placeholder="quantas tem"
          style="width:120px">
        <input class="ent" name="motivo-contagem" placeholder="motivo da diferença" style="flex:1;min-width:150px">
        <button class="btn g sm" data-acao="contar">Ajustar</button>
      </div>
    </div>

    <div class="card">
      <header><div><div class="cod">auditoria</div><div class="nm">Kardex</div></div>
        <span class="pill">${(S.kardex ?? []).length} movimentos</span></header>
      ${(S.kardex ?? []).length ? `<table>
        <tr><th>quando</th><th>tipo</th><th>motivo</th>
            <th style="text-align:right">qtd</th><th style="text-align:right">saldo</th></tr>
        ${S.kardex.map((m) => `
          <tr><td class="mono">${dataBR(m.criado_em)}</td>
            <td><span class="pill mov ${m.tipo}">${esc(m.tipo)}</span></td>
            <td>${esc(m.motivo ?? '—')}${m.codigo ? `<br><span class="fino">${esc(m.codigo)}</span>` : ''}
              ${m.quem ? `<br><span class="fino">${esc(m.quem)}</span>` : ''}</td>
            <td style="text-align:right" class="mono ${m.qtd < 0 ? 'zero' : 'positivo'}">
              ${m.qtd > 0 ? '+' : ''}${m.qtd}</td>
            <td style="text-align:right" class="mono">${m.saldo_depois}</td></tr>`).join('')}
      </table>` : '<div class="vazio">Nenhum movimento registrado.</div>'}
    </div>
  </div>`;
}
