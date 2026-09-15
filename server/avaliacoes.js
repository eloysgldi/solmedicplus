import { um, todos, roda, id, agora } from './db.js';
import { Erro } from './http.js';
import { registra } from './state.js';
import * as avisa from './notificacoes.js';

/** O que a pessoa pode marcar em vez de escrever. Uma palavra, nada de escala. */
export const MARCAS = {
  bom: ['Chegou antes', 'Entregador atencioso', 'Tudo certo na sacola',
        'Farmacêutico explicou', 'Embalagem íntegra'],
  ruim: ['Demorou', 'Faltou item', 'Veio trocado', 'Embalagem amassada',
         'Ninguém me avisou'],
};

export function avalia(orderId, { nota, notaEntrega, marcas = [], comentario, gorjeta = 0 }, user) {
  const o = um('SELECT * FROM orders WHERE id = ?', orderId);
  if (!o) throw new Erro(404, 'PEDIDO_INEXISTENTE', 'Pedido não encontrado');
  if (o.user_id !== user.id) throw new Erro(403, 'SEM_PERMISSAO', 'Esse pedido não é seu');
  if (o.status !== 'entregue') {
    throw new Erro(409, 'PEDIDO_NAO_ENTREGUE', 'Só dá para avaliar depois que o pedido chega');
  }
  if (!(nota >= 1 && nota <= 5)) throw new Erro(422, 'NOTA_INVALIDA', 'A nota vai de 1 a 5');
  if (um('SELECT id FROM avaliacoes WHERE order_id = ?', orderId)) {
    throw new Erro(409, 'JA_AVALIADO', 'Você já avaliou este pedido');
  }
  // nota baixa sem motivo não ajuda ninguém a consertar nada
  if (nota <= 3 && !marcas.length && !comentario) {
    throw new Erro(422, 'MOTIVO_OBRIGATORIO',
      'Conta o que deu errado — sem isso a farmácia não tem o que corrigir');
  }

  const d = um('SELECT courier_id FROM deliveries WHERE order_id = ?', orderId);
  const aid = id();
  roda(`INSERT INTO avaliacoes (id,order_id,user_id,pharmacy_id,courier_id,nota,nota_entrega,
          marcas,comentario,gorjeta_centavos,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    aid, orderId, user.id, o.pharmacy_id, d?.courier_id ?? null, nota, notaEntrega ?? null,
    JSON.stringify(marcas), comentario ?? null, Math.max(0, gorjeta | 0), agora());

  registra(orderId, o.status, o.status, { tipo: 'cliente', id: user.id, nome: user.nome },
    { evento: 'avaliacao', nota, marcas });
  // nota baixa não pode esperar o gerente abrir o painel amanhã
  if (nota <= 3) {
    avisa.paraLoja(o.pharmacy_id, 'avaliacao_ruim', {
      nota, codigo: o.codigo, motivo: marcas.join(', ') || comentario,
    }).catch(() => {});
  }
  return doPedido(orderId);
}

export function doPedido(orderId) {
  const a = um('SELECT * FROM avaliacoes WHERE order_id = ?', orderId);
  return a ? { ...a, marcas: JSON.parse(a.marcas || '[]') } : null;
}

/** Reputação da loja, do jeito que o painel e o admin precisam ver. */
export function daLoja(pharmacyId) {
  const r = um(`SELECT COUNT(*) AS n, AVG(nota) AS media,
                       SUM(CASE WHEN nota <= 3 THEN 1 ELSE 0 END) AS ruins
                  FROM avaliacoes WHERE pharmacy_id = ?`, pharmacyId);
  const marcas = {};
  for (const a of todos('SELECT marcas FROM avaliacoes WHERE pharmacy_id = ?', pharmacyId)) {
    for (const m of JSON.parse(a.marcas || '[]')) marcas[m] = (marcas[m] ?? 0) + 1;
  }
  return {
    avaliacoes: r.n,
    media: r.n ? +Number(r.media).toFixed(2) : null,
    ruins: r.ruins ?? 0,
    marcas: Object.entries(marcas).sort((a, b) => b[1] - a[1]).map(([m, n]) => ({ marca: m, n })),
    ultimas: todos(
      `SELECT nota, marcas, comentario, criado_em FROM avaliacoes
        WHERE pharmacy_id = ? ORDER BY criado_em DESC LIMIT 10`, pharmacyId)
      .map((a) => ({ ...a, marcas: JSON.parse(a.marcas || '[]') })),
  };
}
