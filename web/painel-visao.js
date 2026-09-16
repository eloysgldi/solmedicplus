import { esc, brl, curto, serie, quando, variacao, seloValidade } from './painel-ui.js';

/**
 * A tela que abre o painel.
 *
 * Um dono de farmácia não quer relatório: quer saber em cinco segundos
 * se hoje está indo bem e o que está pegando fogo. É por isso que a
 * ordem aqui é dinheiro → fila → o que precisa de mão, e não "gráficos
 * bonitos primeiro".
 */
export function telaVisao({ S }) {
  const v = S.visao;
  if (!v) return `<h1>Visão geral</h1><div class="card"><div class="vazio">Carregando…</div></div>`;
  const h = v.hoje ?? {};

  const alertas = [
    h.fila ? ['quente', `${h.fila} pedido(s) esperando aceite`, 'pedidos'] : null,
    h.receitas_na_fila ? ['rx', `${h.receitas_na_fila} receita(s) na fila do farmacêutico`, 'receitas'] : null,
    h.retencoes_pendentes ? ['quente', `${h.retencoes_pendentes} via(s) de receita a arquivar`, 'retencao'] : null,
    v.estoque?.zerados ? ['quente', `${v.estoque.zerados} produto(s) zerado(s)`, 'estoque'] : null,
    v.estoque?.vencendo_90d ? ['morno', `${v.estoque.vencendo_90d} lote(s) vencendo em 90 dias`, 'estoque'] : null,
    v.estoque?.divergentes ? ['morno', `${v.estoque.divergentes} divergência(s) entre saldo e lotes`, 'estoque'] : null,
    v.recompras?.length ? ['morno', `${v.recompras.length} cliente(s) passaram do próprio ritmo de recompra`, 'clientes'] : null,
    // a falha silenciosa mais cara da casa: caixa pronta no balcão e
    // ninguém na rua. Só se descobre quando o cliente liga reclamando
    S.alertas?.sem_entregador
      ? ['quente', `${S.alertas.prontos} pedido(s) prontos e nenhum entregador em turno`, 'frota'] : null,
    S.alertas?.parados_ha_20min?.length
      ? ['quente', `${S.alertas.parados_ha_20min.length} pedido(s) parados no balcão há mais de 20 min`, 'pedidos'] : null,
  ].filter(Boolean);

  return `
  <h1>Visão geral</h1>
  <p class="sub">${S.loja.nome_fantasia} · hoje é ${new Date().toLocaleDateString('pt-BR',
    { weekday: 'long', day: 'numeric', month: 'long' })}.</p>

  ${alertas.length ? `
    <div class="tira-alertas">
      ${alertas.map(([t, txt, aba]) => `
        <button class="alerta ${t}" data-aba="${aba}">
          <span class="pt"></span>${esc(txt)}</button>`).join('')}
    </div>` : ''}

  <div class="grade-kpi">
    ${[
      ['faturado hoje', brl(h.bruto_centavos), `${h.entregues_hoje ?? 0} entregues`],
      ['a receber hoje', brl(h.a_receber_centavos), `depois da comissão`],
      ['ticket da semana', brl(v.semana?.ticket_centavos), variacao(v.semana?.variacao_pct)],
      ['ruptura hoje', `${h.ruptura_pct ?? 0}%`, 'pedidos em que faltou item'],
      ['separação média', h.separacao_media_seg
        ? `${Math.floor(h.separacao_media_seg / 60)}min${String(h.separacao_media_seg % 60).padStart(2, '0')}`
        : '—', 'do aceite ao pronto'],
      ['estoque parado', curto(v.estoque?.valor_custo_centavos), `${v.estoque?.unidades ?? 0} unidades a custo`],
    ].map(([k, val, pe]) => `
      <div class="kpi-card"><div class="k">${k}</div><div class="v">${val}</div>
        <div class="pe">${pe ?? ''}</div></div>`).join('')}
  </div>

  <div class="card">
    <header><div><div class="cod">últimos 14 dias</div>
      <div class="nm">${brl(v.mes?.bruto)} em 30 dias</div></div>
      <span class="pill">${v.mes?.pedidos ?? 0} pedidos</span>
      <span class="pill">ticket ${brl(v.mes?.ticket_centavos)}</span></header>
    <div style="padding:16px">${serie(v.serie ?? [])}</div>
  </div>

  <div class="duas-colunas">
    ${blocoRecompras(v.recompras ?? [])}
    ${blocoRisco(v.ruptura ?? [], v.vencendo ?? [])}
  </div>

  <div class="card">
    <header><div><div class="cod">carteira</div><div class="nm">Quem compra aqui</div></div>
      <span class="pill">${v.clientes?.total ?? 0} clientes</span>
      <span class="pill">${v.clientes?.novos_30d ?? 0} novos em 30d</span>
      <span class="pill">${v.clientes?.socios ?? 0} sócios</span></header>
    <div class="faixa-segmentos">
      ${(v.segmentos ?? []).filter((s) => s.clientes).map((s) => `
        <button class="seg-bloco ${s.segmento}" data-segmento="${s.segmento}">
          <b>${s.clientes}</b><span>${ROTULO_SEG[s.segmento] ?? s.segmento}</span>
          <i>${curto(s.valor_centavos)}</i></button>`).join('')
        || '<div class="vazio">Ninguém comprou ainda.</div>'}
    </div>
  </div>`;
}

export const ROTULO_SEG = {
  novo: 'novos', regular: 'regulares', fiel: 'fiéis',
  em_risco: 'em risco', perdido: 'perdidos',
};

/**
 * O bloco que vale mais dinheiro da tela.
 *
 * Não é "quem sumiu há 30 dias": é quem passou do *próprio* intervalo.
 * Para uso contínuo isso costuma significar tratamento interrompido — e
 * aí ligar vale mais do que qualquer cupom.
 */
function blocoRecompras(lista) {
  return `
  <div class="card">
    <header><div><div class="cod">recompra</div>
      <div class="nm">Passaram da hora de voltar</div></div>
      ${lista.length ? `<button class="btn g sm" data-aba="clientes">ver todos</button>` : ''}</header>
    ${lista.length ? lista.map((c) => `
      <button class="linha-cliente" data-cliente="${esc(c.id)}">
        <span class="quem"><b>${esc(c.nome)}</b>
          <span>${esc(c.item_provavel ?? 'compra recorrente')} · ${quando(c.ultima_em)}</span></span>
        <span class="atraso">+${c.atraso_dias}d</span>
      </button>`).join('')
      : '<div class="vazio">Ninguém atrasado. O ciclo está redondo.</div>'}
  </div>`;
}

/** O que ameaça o caixa: o que vai faltar e o que vai vencer sem vender. */
function blocoRisco(ruptura, vencendo) {
  return `
  <div class="card">
    <header><div><div class="cod">risco</div><div class="nm">O que precisa de decisão</div></div>
      <button class="btn g sm" data-aba="estoque">abrir estoque</button></header>
    ${ruptura.length ? `
      <div class="sub-bloco">vai faltar</div>
      ${ruptura.map((r) => `
        <div class="linha-risco">
          <span class="tj vermelho"></span>
          <span class="quem"><b>${esc(r.nome)}</b>
            <span>${r.estoque} em estoque · sai ${r.por_dia}/dia</span></span>
          <span class="prazo ${r.estoque <= 0 ? 'zero' : ''}">
            ${r.estoque <= 0 ? 'zerado' : `${r.dias_para_zerar}d`}</span>
        </div>`).join('')}` : ''}
    ${vencendo.length ? `
      <div class="sub-bloco">vence antes de vender</div>
      ${vencendo.map((l) => `
        <div class="linha-risco">
          <span class="tj ambar"></span>
          <span class="quem"><b>${esc(l.nome)}</b>
            <span>lote ${esc(l.lote)} · ${l.qtd} un</span></span>
          ${seloValidade(l.dias_para_vencer)}
        </div>`).join('')}` : ''}
    ${!ruptura.length && !vencendo.length
      ? '<div class="vazio">Nada pegando fogo no estoque.</div>' : ''}
  </div>`;
}
