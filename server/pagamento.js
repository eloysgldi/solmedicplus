import { um, roda, id, agora } from './db.js';
import { Erro } from './http.js';

/**
 * Adaptador de pagamento. Aqui é mock; trocar por Pagar.me / Stripe / Mercado Pago
 * significa reescrever só estas quatro funções.
 *
 * A regra que não pode ser quebrada: AUTORIZA na hora do pedido,
 * CAPTURA só depois do farmacêutico liberar. Se ele recusar, cancela a
 * autorização e o cliente nunca vê a cobrança no extrato.
 */
export function autoriza(orderId, { metodo = 'cartao', cartaoFinal = '4417', valor }) {
  if (!valor || valor <= 0) throw new Erro(400, 'VALOR_INVALIDO', 'Valor precisa ser maior que zero');
  const pid = id();
  roda(`INSERT INTO payments (id, order_id, provedor, metodo, cartao_final, status,
          valor_autorizado_centavos, external_id, autorizado_em)
        VALUES (?,?,?,?,?,?,?,?,?)`,
    pid, orderId, 'mock', metodo, cartaoFinal, 'autorizado', valor,
    'auth_' + pid.slice(0, 8), agora());
  return um('SELECT * FROM payments WHERE id = ?', pid);
}

/** Captura parcial é o normal aqui: item indisponível reduz o valor. */
export function captura(orderId, valorFinal = null) {
  const p = um(`SELECT * FROM payments WHERE order_id = ? AND status = 'autorizado'`, orderId);
  if (!p) throw new Erro(409, 'SEM_AUTORIZACAO', 'Não há autorização aberta para este pedido');
  const valor = valorFinal ?? p.valor_autorizado_centavos;
  if (valor > p.valor_autorizado_centavos) {
    throw new Erro(409, 'ACIMA_DA_AUTORIZACAO',
      'Captura não pode passar do valor autorizado — refaça a autorização');
  }
  roda(`UPDATE payments SET status='capturado', valor_capturado_centavos=?, capturado_em=? WHERE id=?`,
    valor, agora(), p.id);
  return um('SELECT * FROM payments WHERE id = ?', p.id);
}

export function estorna(orderId, motivo = 'cancelamento') {
  const p = um(`SELECT * FROM payments WHERE order_id = ? ORDER BY autorizado_em DESC`, orderId);
  if (!p) return null;
  if (p.status === 'estornado') return p;
  roda(`UPDATE payments SET status='estornado', estornado_em=?, motivo=? WHERE id=?`,
    agora(), motivo, p.id);
  return um('SELECT * FROM payments WHERE id = ?', p.id);
}

export const doPedido = (orderId) =>
  um('SELECT * FROM payments WHERE order_id = ? ORDER BY autorizado_em DESC', orderId);
