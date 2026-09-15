import { um, todos, roda, id, agora, transacao } from './db.js';
import { Erro } from './http.js';
import * as avisa from './notificacoes.js';
import * as estoque from './estoque.js';

/**
 * ============================================================
 * O armário da casa.
 *
 * Toda caixa entregue entra aqui com o lote e a validade que o balconista
 * bipou na separação. A partir disso a gente consegue fazer três coisas
 * que farmácia nenhuma faz no nível do consumidor:
 *
 *   1. avisar que o remédio vence mês que vem
 *   2. não empurrar o que a pessoa ainda tem em casa
 *   3. quando a Anvisa recolhe um lote, avisar QUEM LEVOU AQUELE LOTE
 *
 * O terceiro é o que muda o jogo. Recall hoje é comunicado genérico no
 * site da Anvisa e cartaz na farmácia — quem comprou nunca fica sabendo.
 * ============================================================
 */

const hoje = () => new Date().toISOString().slice(0, 10);
const diasAte = (data) => data
  ? Math.round((Date.parse(data + 'T12:00:00Z') - Date.now()) / 864e5) : null;

/** Chamado na entrega: o que saiu da loja entra no armário de quem recebeu. */
export function guardaEntrega(orderId) {
  const o = um('SELECT * FROM orders WHERE id = ?', orderId);
  if (!o) return [];
  const itens = todos(
    `SELECT * FROM order_items WHERE order_id = ? AND status IN ('confirmado','substituido')`,
    orderId);

  return transacao(() => itens.map((i) => {
    const ean = i.substituido_por_ean || i.ean;
    const ja = um(`SELECT id FROM armario WHERE order_id = ? AND ean = ?`, orderId, ean);
    if (ja) return ja.id;
    const aid = id();
    roda(`INSERT INTO armario (id,user_id,ean,nome,qtd_inicial,qtd_atual,lote,validade,
            order_id,recebido_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      aid, o.user_id, ean, i.nome_snapshot, i.qtd, i.qtd, i.lote ?? null, i.validade ?? null,
      orderId, o.entregue_em ?? agora(), agora());
    return aid;
  }));
}

/**
 * O que a pessoa tem em casa.
 *
 * Item encerrado some da lista — menos o recolhido: ele fica visível por
 * 30 dias, porque a notificação de recall manda a pessoa exatamente aqui
 * para ver qual caixa parar de usar. Sai quando ela diz que resolveu.
 */
export function doCliente(userId, { incluirEncerrados = false } = {}) {
  const corte = new Date(Date.now() - 30 * 864e5).toISOString();
  const linhas = todos(
    `SELECT a.*, p.principio_ativo, p.dosagem, p.apresentacao, p.forma, p.cor,
            p.requer_receita, p.tarja, p.refrigerado, p.imagem_url
       FROM armario a JOIN products p ON p.ean = a.ean
      WHERE a.user_id = ? ${incluirEncerrados ? '' : `AND (a.encerrado_em IS NULL
            OR (a.motivo = 'recolhido' AND a.encerrado_em >= '${corte}'))`}
      ORDER BY a.recebido_em DESC`, userId);

  return linhas.map((l) => {
    const dias = diasAte(l.validade);
    const recolhido = !!um(
      `SELECT 1 AS x FROM recalls WHERE ean = ? AND (lote IS NULL OR lote = ?)`, l.ean, l.lote ?? '');
    const estado = recolhido ? 'recolhido'
      : dias !== null && dias < 0 ? 'vencido'
      : dias !== null && dias <= 60 ? 'vencendo'
      : 'ok';
    return { ...l, dias_para_vencer: dias, estado };
  });
}

export function resumo(userId) {
  const itens = doCliente(userId);
  return {
    total: itens.length,
    recolhidos: itens.filter((i) => i.estado === 'recolhido').length,
    vencidos: itens.filter((i) => i.estado === 'vencido').length,
    vencendo: itens.filter((i) => i.estado === 'vencendo').length,
  };
}

/** A pessoa ajusta o que sobrou, ou diz que acabou. */
export function ajusta(aid, userId, { qtd_atual, encerrar, motivo }) {
  const a = um('SELECT * FROM armario WHERE id = ? AND user_id = ?', aid, userId);
  if (!a) throw new Erro(404, 'ITEM_INEXISTENTE', 'Esse item não está no seu armário');
  if (encerrar) {
    roda(`UPDATE armario SET encerrado_em=?, motivo=?, qtd_atual=0, atualizado_em=? WHERE id=?`,
      agora(), motivo ?? 'acabou', agora(), aid);
  } else {
    const n = Math.max(0, Number(qtd_atual ?? a.qtd_atual));
    roda(`UPDATE armario SET qtd_atual=?, atualizado_em=?,
            encerrado_em = CASE WHEN ? = 0 THEN ? ELSE NULL END,
            motivo = CASE WHEN ? = 0 THEN 'acabou' ELSE NULL END WHERE id=?`,
      n, agora(), n, agora(), n, aid);
  }
  return um('SELECT * FROM armario WHERE id = ?', aid);
}

/** O que a pessoa já tem, para o carrinho não empurrar de novo. */
export function jaTem(userId, eans = []) {
  if (!eans.length) return [];
  return doCliente(userId).filter((i) => eans.includes(i.ean) && i.qtd_atual > 0
    && i.estado !== 'vencido' && i.estado !== 'recolhido');
}

/* ============================================================
   RECALL
   Quando um lote é recolhido, a gente não publica comunicado: a gente
   avisa quem levou aquele lote, pelo nome, na hora.
   ============================================================ */

export function registraRecall({ ean, lote, motivo, origem = 'anvisa', referencia,
                                 gravidade = 'alta' }, autorId, pharmacyId) {
  const p = um('SELECT * FROM products WHERE ean = ?', ean);
  if (!p) throw new Erro(404, 'PRODUTO_INEXISTENTE', `EAN ${ean} não existe no catálogo`);
  if (!motivo || motivo.trim().length < 5) {
    throw new Erro(422, 'MOTIVO_OBRIGATORIO',
      'Escreva o motivo do recolhimento: é o que o cliente vai ler');
  }

  const atingidos = todos(
    `SELECT a.*, u.nome AS cliente FROM armario a JOIN users u ON u.id = a.user_id
      WHERE a.ean = ? AND (? IS NULL OR a.lote = ?) AND a.encerrado_em IS NULL`,
    ean, lote ?? null, lote ?? null);

  const rid = id();
  let retirados = [];
  transacao(() => {
    roda(`INSERT INTO recalls (id,ean,lote,motivo,origem,referencia,gravidade,
            criado_por,atingidos,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      rid, ean, lote ?? null, motivo, origem, referencia ?? null, gravidade,
      autorId ?? null, atingidos.length, agora());

    // o item sai do armário como recolhido, não como "acabou"
    for (const a of atingidos) {
      roda(`UPDATE armario SET encerrado_em=?, motivo='recolhido', atualizado_em=? WHERE id=?`,
        agora(), agora(), a.id);
    }
    // e some do catálogo enquanto o recolhimento estiver de pé
    roda('UPDATE inventory SET ativo = 0 WHERE ean = ?', ean);
    // o que ainda está na prateleira também para de existir para a venda:
    // lote recolhido bloqueado, com movimento no kardex explicando por quê
    if (pharmacyId) retirados = estoque.bloqueiaLote(pharmacyId, ean, lote ?? null);
  });

  // avisar é a parte que importa, e não pode travar o registro
  for (const a of atingidos) {
    avisa.paraCliente(a.user_id, 'recall', null, {
      produto: p.nome, lote: a.lote, motivo, referencia,
    }).catch(() => {});
  }

  return {
    ...um('SELECT * FROM recalls WHERE id = ?', rid),
    produto: p.nome,
    avisados: atingidos.map((a) => ({ cliente: a.cliente, lote: a.lote, pedido: a.order_id })),
    // o que foi tirado da prateleira antes de sair
    retirados,
    unidades_retiradas: retirados.reduce((s, r) => s + r.retirado, 0),
  };
}

export const listaRecalls = (limite = 30) => todos(
  `SELECT r.*, p.nome AS produto FROM recalls r JOIN products p ON p.ean = r.ean
    ORDER BY r.criado_em DESC LIMIT ?`, limite);

/**
 * Varredura de validade. Roda de tempos em tempos e avisa uma vez só
 * por item — ninguém merece o mesmo alerta todo dia.
 */
export function avisaVencimentos({ dias = 45 } = {}) {
  const alvo = new Date(Date.now() + dias * 864e5).toISOString().slice(0, 10);
  const itens = todos(
    `SELECT a.*, u.id AS uid FROM armario a JOIN users u ON u.id = a.user_id
      WHERE a.encerrado_em IS NULL AND a.validade IS NOT NULL
        AND a.validade <= ? AND a.validade >= ? AND a.avisado_em IS NULL`, alvo, hoje());
  for (const i of itens) {
    roda('UPDATE armario SET avisado_em = ? WHERE id = ?', agora(), i.id);
    avisa.paraCliente(i.uid, 'vencendo', null, {
      produto: i.nome, validade: i.validade, dias: diasAte(i.validade),
    }).catch(() => {});
  }
  return itens.length;
}
