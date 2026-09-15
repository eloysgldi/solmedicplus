import { um, todos, roda, id, agora } from './db.js';
import { publica } from './events.js';

/**
 * A máquina de estados do pedido.
 * Chave = estado atual. Valor = { proximo_estado: [papéis que podem levar lá] }.
 * Nada muda de estado fora daqui — é o que garante que a cobrança
 * nunca acontece antes da liberação do farmacêutico.
 */
export const TRANSICOES = {
  criado:             { aguardando_loja:    ['sistema'],
                        cancelado:          ['cliente','sistema'] },

  aguardando_loja:    { aguardando_receita: ['loja'],
                        em_separacao:       ['loja'],
                        cancelado:          ['loja','cliente','sistema'] },

  // roda em paralelo à separação dos itens livres
  aguardando_receita: { em_separacao:       ['farmaceutico'],
                        cancelado:          ['farmaceutico','cliente','sistema'] },

  em_separacao:       { aguardando_cliente: ['loja'],
                        pronto:             ['loja'],
                        cancelado:          ['loja','sistema'] },

  // contraproposta de substituição esperando resposta
  aguardando_cliente: { em_separacao:       ['cliente','sistema'],
                        cancelado:          ['cliente','sistema'] },

  pronto:             { em_rota:            ['entregador','loja'],
                        cancelado:          ['loja','sistema'] },

  em_rota:            { entregue:           ['entregador'],
                        cancelado:          ['sistema'] },

  entregue:           {},
  cancelado:          {},
};

export const CARIMBO = {
  aguardando_loja: null,
  em_separacao: 'aceito_em',
  pronto: 'separado_em',
  em_rota: 'despachado_em',
  entregue: 'entregue_em',
  cancelado: 'cancelado_em',
};

export class TransicaoInvalida extends Error {
  constructor(de, para, ator) {
    super(`Transição inválida: ${de} -> ${para} por ${ator}`);
    this.code = 'TRANSICAO_INVALIDA';
    this.status = 409;
  }
}

/** Registra um evento na trilha de auditoria. Não é log — é prova. */
export function registra(orderId, de, para, ator, detalhe = null) {
  roda(
    `INSERT INTO order_events (id, order_id, de_status, para_status, ator_tipo, ator_id, ator_nome, detalhe, criado_em)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id(), orderId, de, para, ator.tipo, ator.id ?? null, ator.nome ?? null,
    detalhe ? JSON.stringify(detalhe) : null, agora()
  );
}

/**
 * Única porta de saída para mudar o estado de um pedido.
 * Valida a transição, carimba a data, grava a auditoria e avisa quem está ouvindo.
 */
export function transiciona(orderId, para, ator, detalhe = null) {
  const pedido = um('SELECT * FROM orders WHERE id = ?', orderId);
  if (!pedido) { const e = new Error('Pedido não encontrado'); e.status = 404; throw e; }

  const permitidos = TRANSICOES[pedido.status]?.[para];
  if (!permitidos || !permitidos.includes(ator.tipo)) {
    throw new TransicaoInvalida(pedido.status, para, ator.tipo);
  }

  const campo = CARIMBO[para];
  if (campo) roda(`UPDATE orders SET status = ?, ${campo} = ? WHERE id = ?`, para, agora(), orderId);
  else roda('UPDATE orders SET status = ? WHERE id = ?', para, orderId);

  if (para === 'cancelado' && detalhe?.motivo) {
    roda('UPDATE orders SET motivo_cancelamento = ? WHERE id = ?', detalhe.motivo, orderId);
  }

  registra(orderId, pedido.status, para, ator, detalhe);

  const atualizado = um('SELECT * FROM orders WHERE id = ?', orderId);
  publica(`pedido:${orderId}`, { tipo: 'status', pedido: atualizado });
  publica(`loja:${pedido.pharmacy_id}`, { tipo: 'status', pedido: atualizado });
  return atualizado;
}

/** Linha do tempo pronta para a tela do cliente. */
export function linhaDoTempo(orderId) {
  return todos(
    `SELECT para_status AS status, ator_tipo, ator_nome, detalhe, criado_em
       FROM order_events WHERE order_id = ? ORDER BY criado_em`, orderId);
}
