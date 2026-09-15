import { um, todos, roda, id, agora, transacao } from './db.js';
import { Erro } from './http.js';

/**
 * ============================================================
 * ESTOQUE
 *
 * Duas camadas, de propósito:
 *
 *   inventory.estoque   saldo agregado — é o que a vitrine lê e o que a
 *                       reserva do pedido trava. Rápido, uma linha por SKU.
 *   estoque_lotes       a verdade física — qual caixa, que validade, que
 *                       custo, de qual nota.
 *
 * Toda mudança passa por `movimenta()`, que escreve no kardex. Se o saldo
 * agregado e a soma dos lotes divergirem, `conferencia()` mostra onde.
 * ============================================================
 */

const hoje = () => new Date().toISOString().slice(0, 10);
const diasAte = (d) => d ? Math.round((Date.parse(d + 'T12:00:00Z') - Date.now()) / 864e5) : null;

/** Toda entrada e saída passa por aqui. Sem exceção: o kardex é a auditoria. */
function movimenta(pid, { ean, lote_id, tipo, qtd, motivo, order_id, user_id, custo }) {
  const inv = um('SELECT * FROM inventory WHERE pharmacy_id = ? AND ean = ?', pid, ean);
  if (!inv) throw new Erro(404, 'FORA_DO_CATALOGO', `${ean} não está no catálogo desta loja`);
  const saldo = inv.estoque + qtd;
  if (saldo < 0) {
    throw new Erro(422, 'SALDO_NEGATIVO',
      `Não dá para tirar ${Math.abs(qtd)}: o saldo de ${ean} é ${inv.estoque}`);
  }
  roda('UPDATE inventory SET estoque = ?, atualizado_em = ? WHERE pharmacy_id = ? AND ean = ?',
    saldo, agora(), pid, ean);
  roda(`INSERT INTO estoque_mov (id,pharmacy_id,ean,lote_id,tipo,qtd,saldo_depois,
          custo_centavos,motivo,order_id,user_id,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    id(), pid, ean, lote_id ?? null, tipo, qtd, saldo, custo ?? null,
    motivo ?? null, order_id ?? null, user_id ?? null, agora());
  return saldo;
}

/**
 * Recebimento de nota. É aqui que lote e validade entram no sistema —
 * uma vez só, na porta dos fundos, em vez de serem digitados a cada venda.
 */
export function entrada(pid, { ean, lote, validade, qtd, custo_centavos,
                               fornecedor, nota_fiscal }, userId) {
  if (!lote?.trim()) throw new Erro(422, 'LOTE_OBRIGATORIO', 'Toda entrada precisa de lote');
  const n = Number(qtd);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Erro(422, 'QTD_INVALIDA', 'Quantidade tem que ser um número inteiro positivo');
  }
  if (validade && validade < hoje()) {
    throw new Erro(422, 'JA_VENCIDO', `Esse lote venceu em ${validade}. Não entra.`);
  }
  return transacao(() => {
    // lote repetido da mesma nota soma no lote que já existe
    const existente = um(
      `SELECT * FROM estoque_lotes WHERE pharmacy_id=? AND ean=? AND lote=?
        AND IFNULL(validade,'') = IFNULL(?,'')`, pid, ean, lote.trim(), validade ?? null);
    let loteId;
    if (existente) {
      loteId = existente.id;
      roda(`UPDATE estoque_lotes SET qtd = qtd + ?, qtd_inicial = qtd_inicial + ?,
              custo_centavos = COALESCE(?, custo_centavos), bloqueado = 0 WHERE id = ?`,
        n, n, custo_centavos ?? null, loteId);
    } else {
      loteId = id();
      roda(`INSERT INTO estoque_lotes (id,pharmacy_id,ean,lote,validade,qtd,qtd_inicial,
              custo_centavos,fornecedor,nota_fiscal,entrada_em,criado_por)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        loteId, pid, ean, lote.trim(), validade ?? null, n, n, custo_centavos ?? null,
        fornecedor ?? null, nota_fiscal ?? null, agora(), userId ?? null);
    }
    const saldo = movimenta(pid, { ean, lote_id: loteId, tipo: 'entrada', qtd: n,
      custo: custo_centavos, motivo: nota_fiscal ? `NF ${nota_fiscal}` : 'entrada manual',
      user_id: userId });
    return { lote_id: loteId, saldo };
  });
}

/**
 * FEFO — first expire, first out. O que vence antes sai antes; é regra
 * de farmácia, não preferência. Devolve de quais lotes saiu a quantidade.
 */
export function separaFEFO(pid, ean, qtd, { order_id, user_id } = {}) {
  const lotes = todos(
    `SELECT * FROM estoque_lotes WHERE pharmacy_id=? AND ean=? AND qtd > 0 AND bloqueado = 0
      ORDER BY CASE WHEN validade IS NULL THEN 1 ELSE 0 END, validade, entrada_em`, pid, ean);

  let falta = qtd;
  const usados = [];
  return transacao(() => {
    for (const l of lotes) {
      if (falta <= 0) break;
      const leva = Math.min(l.qtd, falta);
      roda('UPDATE estoque_lotes SET qtd = qtd - ? WHERE id = ?', leva, l.id);
      movimenta(pid, { ean, lote_id: l.id, tipo: 'venda', qtd: -leva, order_id, user_id,
        motivo: 'separação' });
      usados.push({ lote: l.lote, validade: l.validade, qtd: leva });
      falta -= leva;
    }
    // sem lote cadastrado o saldo agregado ainda baixa: a loja pode estar
    // migrando para controle por lote e a venda não pode parar por isso
    if (falta > 0) {
      movimenta(pid, { ean, tipo: 'venda', qtd: -falta, order_id, user_id,
        motivo: 'separação sem lote' });
      usados.push({ lote: null, validade: null, qtd: falta });
    }
    return usados;
  });
}

/**
 * Encaixa uma diferença de saldo nos lotes.
 *
 * Sobra entra no lote mais novo (foi ele que chegou e ninguém deu baixa);
 * falta sai do que vence primeiro. Sem isso, toda correção de saldo
 * deixaria as duas camadas brigando para sempre.
 */
export function sincronizaLotes(pid, ean, dif) {
  if (!dif) return;
  if (dif > 0) {
    const l = um(`SELECT * FROM estoque_lotes WHERE pharmacy_id=? AND ean=? AND bloqueado=0
                   ORDER BY entrada_em DESC LIMIT 1`, pid, ean);
    if (l) roda('UPDATE estoque_lotes SET qtd = qtd + ? WHERE id = ?', dif, l.id);
    return;
  }
  let falta = -dif;
  for (const l of todos(`SELECT * FROM estoque_lotes WHERE pharmacy_id=? AND ean=? AND qtd>0
                          ORDER BY CASE WHEN validade IS NULL THEN 1 ELSE 0 END, validade`, pid, ean)) {
    if (falta <= 0) break;
    const tira = Math.min(l.qtd, falta);
    roda('UPDATE estoque_lotes SET qtd = qtd - ? WHERE id = ?', tira, l.id);
    falta -= tira;
  }
}

/** Contagem de prateleira. A diferença vira movimento, não um UPDATE mudo. */
export function contagem(pid, { ean, qtd_contada, motivo }, userId) {
  const inv = um('SELECT * FROM inventory WHERE pharmacy_id=? AND ean=?', pid, ean);
  if (!inv) throw new Erro(404, 'FORA_DO_CATALOGO', `${ean} não está no catálogo desta loja`);
  const n = Number(qtd_contada);
  if (!Number.isInteger(n) || n < 0) throw new Erro(422, 'QTD_INVALIDA', 'Contagem inválida');
  const dif = n - inv.estoque;
  if (dif === 0) return { diferenca: 0, saldo: n };
  if (!motivo?.trim()) {
    throw new Erro(422, 'MOTIVO_OBRIGATORIO',
      `A contagem difere do sistema em ${dif > 0 ? '+' : ''}${dif}. Escreva o porquê.`);
  }
  return transacao(() => {
    const saldo = movimenta(pid, { ean, tipo: 'ajuste', qtd: dif, motivo: motivo.trim(),
      user_id: userId });
    sincronizaLotes(pid, ean, dif);
    return { diferenca: dif, saldo };
  });
}

/** Quebra, vencido, avaria. Sai do estoque e fica registrado por quê. */
export function perda(pid, { lote_id, ean, qtd, motivo }, userId) {
  if (!motivo?.trim()) throw new Erro(422, 'MOTIVO_OBRIGATORIO', 'Perda sem motivo não entra');
  const n = Number(qtd);
  if (!Number.isInteger(n) || n <= 0) throw new Erro(422, 'QTD_INVALIDA', 'Quantidade inválida');
  const l = lote_id ? um('SELECT * FROM estoque_lotes WHERE id=? AND pharmacy_id=?', lote_id, pid) : null;
  if (lote_id && !l) throw new Erro(404, 'LOTE_INEXISTENTE', 'Esse lote não existe aqui');
  if (l && l.qtd < n) throw new Erro(422, 'SALDO_NEGATIVO', `O lote ${l.lote} tem ${l.qtd}`);
  const alvo = l?.ean ?? ean;
  return transacao(() => {
    if (l) roda('UPDATE estoque_lotes SET qtd = qtd - ? WHERE id = ?', n, l.id);
    const saldo = movimenta(pid, { ean: alvo, lote_id: l?.id, tipo: 'perda', qtd: -n,
      motivo: motivo.trim(), user_id: userId, custo: l?.custo_centavos });
    return { saldo, perdido_centavos: (l?.custo_centavos ?? 0) * n };
  });
}

/** Devolução de pedido cancelado depois de separado: volta para a prateleira. */
export function devolve(pid, orderId, userId) {
  const itens = todos(
    `SELECT ean, qtd FROM order_items WHERE order_id=? AND status IN ('confirmado','substituido')`,
    orderId);
  return transacao(() => itens.map((i) => movimenta(pid, { ean: i.ean, tipo: 'devolucao',
    qtd: i.qtd, order_id: orderId, user_id: userId, motivo: 'pedido cancelado' })));
}

/* ============================================================
   LEITURA
   ============================================================ */

/** Posição completa: saldo, lotes, custo, giro e cobertura em dias. */
export function posicao(pid, { q = '', filtro = 'todos' } = {}) {
  const busca = `%${q.trim().toLowerCase()}%`;
  const linhas = todos(
    `SELECT i.ean, i.preco_centavos, i.preco_socio_centavos, i.estoque, i.estoque_reservado,
            i.ativo, i.posicao, p.nome, p.apresentacao, p.dosagem, p.fabricante, p.tarja,
            p.refrigerado, p.imagem_url, p.pmc_centavos,
            (SELECT COALESCE(SUM(qtd),0) FROM estoque_lotes l
              WHERE l.pharmacy_id=i.pharmacy_id AND l.ean=i.ean) AS em_lotes,
            (SELECT COUNT(*) FROM estoque_lotes l
              WHERE l.pharmacy_id=i.pharmacy_id AND l.ean=i.ean AND l.qtd>0) AS lotes_abertos,
            (SELECT MIN(validade) FROM estoque_lotes l
              WHERE l.pharmacy_id=i.pharmacy_id AND l.ean=i.ean AND l.qtd>0) AS vence_primeiro,
            (SELECT custo_centavos FROM estoque_lotes l
              WHERE l.pharmacy_id=i.pharmacy_id AND l.ean=i.ean AND l.custo_centavos IS NOT NULL
              ORDER BY entrada_em DESC LIMIT 1) AS custo_centavos,
            (SELECT COALESCE(SUM(oi.qtd),0) FROM order_items oi JOIN orders o ON o.id=oi.order_id
              WHERE o.pharmacy_id=i.pharmacy_id AND oi.ean=i.ean AND o.status='entregue'
                AND o.entregue_em >= datetime('now','-30 days')) AS vendidos_30d
       FROM inventory i JOIN products p ON p.ean = i.ean
      WHERE i.pharmacy_id = ?
        AND (? = '%%' OR lower(p.nome) LIKE ? OR i.ean LIKE ?)
      ORDER BY p.nome`, pid, busca, busca, busca);

  const itens = linhas.map((l) => {
    const porDia = l.vendidos_30d / 30;
    const cobertura = porDia > 0 ? Math.floor(l.estoque / porDia) : null;
    const dias = diasAte(l.vence_primeiro);
    return {
      ...l,
      disponivel: l.estoque - l.estoque_reservado,
      por_dia: +porDia.toFixed(2),
      cobertura_dias: cobertura,
      dias_para_vencer: dias,
      valor_custo_centavos: (l.custo_centavos ?? 0) * l.estoque,
      valor_venda_centavos: l.preco_centavos * l.estoque,
      margem_pct: l.custo_centavos
        ? +(((l.preco_centavos - l.custo_centavos) / l.preco_centavos) * 100).toFixed(1) : null,
      divergente: l.lotes_abertos > 0 && l.em_lotes !== l.estoque,
      alerta: l.estoque <= 0 ? 'zerado'
        : cobertura !== null && cobertura <= 5 ? 'acabando'
        : dias !== null && dias <= 90 ? 'vencendo'
        : l.lotes_abertos > 0 && l.em_lotes !== l.estoque ? 'divergente'
        : null,
    };
  });

  if (filtro === 'todos') return itens;
  if (filtro === 'parados') return itens.filter((i) => i.vendidos_30d === 0 && i.estoque > 0);
  return itens.filter((i) => i.alerta === filtro);
}

/** O dinheiro que está parado na prateleira, e o que ameaça virar perda. */
export function resumo(pid) {
  const itens = posicao(pid);
  const mes = new Date(Date.now() - 30 * 864e5).toISOString();
  const perdas = todos(
    `SELECT qtd, custo_centavos FROM estoque_mov
      WHERE pharmacy_id=? AND tipo='perda' AND criado_em >= ?`, pid, mes);
  return {
    skus: itens.length,
    skus_ativos: itens.filter((i) => i.ativo).length,
    zerados: itens.filter((i) => i.estoque <= 0).length,
    acabando: itens.filter((i) => i.alerta === 'acabando').length,
    parados: itens.filter((i) => i.vendidos_30d === 0 && i.estoque > 0).length,
    divergentes: itens.filter((i) => i.divergente).length,
    unidades: itens.reduce((s, i) => s + i.estoque, 0),
    valor_custo_centavos: itens.reduce((s, i) => s + i.valor_custo_centavos, 0),
    valor_venda_centavos: itens.reduce((s, i) => s + i.valor_venda_centavos, 0),
    perdas_mes_centavos: perdas.reduce((s, m) => s + Math.abs(m.qtd) * (m.custo_centavos ?? 0), 0),
    perdas_mes_unidades: perdas.reduce((s, m) => s + Math.abs(m.qtd), 0),
    vencendo_90d: lotesVencendo(pid, 90).length,
  };
}

/** O que vence na prateleira. Perda aqui é prejuízo puro: já foi pago. */
export function lotesVencendo(pid, dias = 90) {
  const alvo = new Date(Date.now() + dias * 864e5).toISOString().slice(0, 10);
  return todos(
    `SELECT l.*, p.nome, p.apresentacao, i.preco_centavos
       FROM estoque_lotes l JOIN products p ON p.ean = l.ean
       LEFT JOIN inventory i ON i.ean = l.ean AND i.pharmacy_id = l.pharmacy_id
      WHERE l.pharmacy_id = ? AND l.qtd > 0 AND l.validade IS NOT NULL AND l.validade <= ?
      ORDER BY l.validade`, pid, alvo)
    .map((l) => ({ ...l, dias_para_vencer: diasAte(l.validade),
      vencido: l.validade < hoje(),
      parado_centavos: (l.custo_centavos ?? 0) * l.qtd }));
}

/** Lotes de um produto, do que vence primeiro para o que vence depois. */
export const lotesDo = (pid, ean) => todos(
  `SELECT * FROM estoque_lotes WHERE pharmacy_id=? AND ean=?
    ORDER BY CASE WHEN validade IS NULL THEN 1 ELSE 0 END, validade`, pid, ean)
  .map((l) => ({ ...l, dias_para_vencer: diasAte(l.validade) }));

/** Kardex: o extrato do produto. Toda divergência é explicada aqui. */
export const kardex = (pid, ean, limite = 60) => todos(
  `SELECT m.*, u.nome AS quem, l.lote, o.codigo
     FROM estoque_mov m
     LEFT JOIN users u ON u.id = m.user_id
     LEFT JOIN estoque_lotes l ON l.id = m.lote_id
     LEFT JOIN orders o ON o.id = m.order_id
    WHERE m.pharmacy_id = ? AND m.ean = ?
    ORDER BY m.criado_em DESC LIMIT ?`, pid, ean, limite);

/**
 * Curva ABC por faturamento dos últimos 90 dias.
 * A = os 80% do dinheiro. É a lista do que nunca pode faltar.
 */
export function abc(pid) {
  const linhas = todos(
    `SELECT oi.ean, p.nome, SUM(oi.qtd) AS unidades,
            SUM(oi.preco_total_centavos) AS receita_centavos
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.ean = oi.ean
      WHERE o.pharmacy_id = ? AND o.status = 'entregue'
        AND o.entregue_em >= datetime('now','-90 days')
      GROUP BY oi.ean ORDER BY receita_centavos DESC`, pid);

  const total = linhas.reduce((s, l) => s + l.receita_centavos, 0) || 1;
  let acumulado = 0;
  return linhas.map((l) => {
    acumulado += l.receita_centavos;
    const pct = (acumulado / total) * 100;
    return { ...l, participacao_pct: +((l.receita_centavos / total) * 100).toFixed(1),
      acumulado_pct: +pct.toFixed(1), curva: pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C' };
  });
}

/** Quando o saldo agregado e a soma dos lotes brigam, é aqui que aparece. */
export const conferencia = (pid) => posicao(pid).filter((i) => i.divergente)
  .map((i) => ({ ean: i.ean, nome: i.nome, sistema: i.estoque, em_lotes: i.em_lotes,
    diferenca: i.em_lotes - i.estoque }));

/** Recall trava o lote sem apagar: o histórico continua auditável. */
export function bloqueiaLote(pid, ean, lote) {
  const alvos = todos(
    `SELECT * FROM estoque_lotes WHERE pharmacy_id=? AND ean=? AND qtd>0
      AND (? IS NULL OR lote = ?)`, pid, ean, lote ?? null, lote ?? null);
  return transacao(() => alvos.map((l) => {
    roda('UPDATE estoque_lotes SET bloqueado = 1 WHERE id = ?', l.id);
    movimenta(pid, { ean, lote_id: l.id, tipo: 'recall', qtd: -l.qtd,
      motivo: `lote ${l.lote} recolhido` });
    roda('UPDATE estoque_lotes SET qtd = 0 WHERE id = ?', l.id);
    return { lote: l.lote, retirado: l.qtd };
  }));
}

/**
 * A baixa da separação.
 *
 * A caixa sai da prateleira quando o balconista separa, não quando o
 * motoboy entrega — é nesse instante que o estoque físico muda.
 *
 * Se ele bipou o lote, o lote bipado manda. Se não bipou, o sistema
 * escolhe por FEFO e grava o lote escolhido no item: o cliente recebe
 * rastreabilidade mesmo quando ninguém digitou nada.
 */
export function baixaSeparacao(pid, orderId, conferencia = [], userId) {
  const itens = todos(
    `SELECT * FROM order_items WHERE order_id=? AND status IN ('pendente','confirmado','substituido')`,
    orderId);

  return transacao(() => itens.map((i) => {
    const ean = i.substituido_por_ean || i.ean;
    const bipado = conferencia.find((c) => c.item_id === i.id);
    const inv = um('SELECT estoque FROM inventory WHERE pharmacy_id=? AND ean=?', pid, ean);
    // separar mais do que existe é erro de contagem, não motivo para travar
    // a entrega: baixa o que dá e a divergência aparece na conferência
    const leva = Math.min(i.qtd, inv?.estoque ?? 0);
    let usados = [];

    if (leva > 0) {
      const doLote = bipado?.lote && um(
        `SELECT * FROM estoque_lotes WHERE pharmacy_id=? AND ean=? AND lote=? AND qtd>=?`,
        pid, ean, bipado.lote, leva);
      if (doLote) {
        roda('UPDATE estoque_lotes SET qtd = qtd - ? WHERE id = ?', leva, doLote.id);
        movimenta(pid, { ean, lote_id: doLote.id, tipo: 'venda', qtd: -leva,
          order_id: orderId, user_id: userId, motivo: 'separação' });
        usados = [{ lote: doLote.lote, validade: doLote.validade, qtd: leva }];
      } else {
        usados = separaFEFO(pid, ean, leva, { order_id: orderId, user_id: userId });
      }
    }

    const escolhido = usados.find((u) => u.lote) ?? {};
    const lote = bipado?.lote ?? escolhido.lote ?? i.lote ?? null;
    const validade = bipado?.validade ?? escolhido.validade ?? i.validade ?? null;
    roda('UPDATE order_items SET lote=?, validade=? WHERE id=?', lote, validade, i.id);
    return { item_id: i.id, ean, lote, validade, baixado: leva, faltou: i.qtd - leva };
  }));
}

/** Os últimos movimentos da loja inteira — a régua de auditoria do dia. */
export const movimentos = (pid, limite = 60) => todos(
  `SELECT m.*, p.nome, u.nome AS quem, l.lote, o.codigo
     FROM estoque_mov m JOIN products p ON p.ean = m.ean
     LEFT JOIN users u ON u.id = m.user_id
     LEFT JOIN estoque_lotes l ON l.id = m.lote_id
     LEFT JOIN orders o ON o.id = m.order_id
    WHERE m.pharmacy_id = ? ORDER BY m.criado_em DESC LIMIT ?`, pid, limite);
