import { um, todos, roda, id, agora, transacao } from './db.js';
import { Erro } from './http.js';
import { publica } from './events.js';

/**
 * ============================================================
 * O ENTREGADOR
 *
 * Três decisões que definem o desenho deste módulo:
 *
 *   1. Quem cadastra o piloto, escolhe o veículo e liga o rastreamento é
 *      a LOJA. Localização em tempo real é dado sensível de uma pessoa;
 *      quem responde pelo vínculo é quem assume a responsabilidade.
 *
 *   2. O entregador ainda precisa aceitar. A loja liga a possibilidade,
 *      o aparelho dele confirma — sem o toque dele, o navegador nem
 *      pergunta. Vigilância sem consentimento não é produto, é processo.
 *
 *   3. A posição é gravada com histórico, não só sobrescrita. É o que
 *      permite reconstruir uma entrega contestada — e é por isso que
 *      existe prazo de descarte, não acúmulo eterno.
 * ============================================================
 */

const VEICULOS = ['moto', 'bike', 'carro', 'a_pe'];

/** A ficha do entregador a partir da conta logada. */
export function meuCadastro(userId) {
  return um(
    `SELECT c.*, f.nome_fantasia, f.lat AS loja_lat, f.lng AS loja_lng,
            f.logradouro AS loja_rua, f.numero AS loja_numero
       FROM couriers c JOIN pharmacies f ON f.id = c.pharmacy_id
      WHERE c.user_id = ? AND c.ativo = 1`, userId);
}

/* ============================================================
   LADO DA LOJA — cadastro da frota
   ============================================================ */

export function listaDaLoja(pid) {
  return todos(
    `SELECT c.*, u.email,
            (SELECT COUNT(*) FROM deliveries d JOIN orders o ON o.id = d.order_id
              WHERE d.courier_id = c.id AND o.status = 'em_rota') AS em_rota,
            (SELECT COUNT(*) FROM deliveries d JOIN orders o ON o.id = d.order_id
              WHERE d.courier_id = c.id AND o.status = 'entregue'
                AND o.entregue_em >= datetime('now','-30 days')) AS entregas_30d
       FROM couriers c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.pharmacy_id = ? ORDER BY c.ativo DESC, c.nome`, pid);
}

/**
 * Cadastra ou atualiza um piloto.
 *
 * A conta de acesso é criada junto: entregador que precisa esperar
 * alguém "abrir o login" não entra em turno no dia em que foi contratado.
 */
export function salvaEntregador(pid, dados, criarConta) {
  const { nome, telefone, veiculo = 'moto', placa, cnh, caixa_termica,
          rastreavel = 1, ativo = 1, email, senha, observacao } = dados;

  if (!nome?.trim()) throw new Erro(422, 'NOME_OBRIGATORIO', 'O piloto precisa de nome');
  if (!VEICULOS.includes(veiculo)) {
    throw new Erro(422, 'VEICULO_INVALIDO', `Veículo desconhecido: ${veiculo}`);
  }
  if (veiculo === 'moto' && !placa?.trim()) {
    throw new Erro(422, 'PLACA_OBRIGATORIA', 'Moto sem placa não sai para entrega');
  }

  return transacao(() => {
    if (dados.id) {
      const atual = um('SELECT * FROM couriers WHERE id = ? AND pharmacy_id = ?', dados.id, pid);
      if (!atual) throw new Erro(404, 'ENTREGADOR_INEXISTENTE', 'Esse entregador não é desta loja');
      roda(`UPDATE couriers SET nome=?, telefone=?, veiculo=?, placa=?, cnh=?,
              caixa_termica=?, rastreavel=?, ativo=?, observacao=? WHERE id=?`,
        nome.trim(), telefone ?? null, veiculo, placa ?? null, cnh ?? null,
        caixa_termica ? 1 : 0, rastreavel ? 1 : 0, ativo ? 1 : 0,
        observacao ?? null, dados.id);
      return um('SELECT * FROM couriers WHERE id = ?', dados.id);
    }

    let uid = null;
    if (email?.trim()) {
      const ja = um('SELECT id FROM users WHERE email = ?', email.trim());
      uid = ja?.id ?? criarConta({ nome: nome.trim(), email: email.trim(), senha, telefone });
    }
    const cid = id();
    roda(`INSERT INTO couriers (id,user_id,pharmacy_id,nome,telefone,veiculo,placa,cnh,
            caixa_termica,rastreavel,ativo,observacao,criado_em)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      cid, uid, pid, nome.trim(), telefone ?? null, veiculo, placa ?? null, cnh ?? null,
      caixa_termica ? 1 : 0, rastreavel ? 1 : 0, ativo ? 1 : 0, observacao ?? null, agora());
    return um('SELECT * FROM couriers WHERE id = ?', cid);
  });
}

/* ============================================================
   LADO DO ENTREGADOR — turno, fila e posicao
   ============================================================ */

/** Abre e fecha o turno. Fora de turno, nada de posicao e nada de fila. */
export function turno(courierId, entrando) {
  roda('UPDATE couriers SET em_turno = ? WHERE id = ?', entrando ? 1 : 0, courierId);
  if (!entrando) {
    // sair do turno apaga a ultima posicao conhecida: o app nao fica
    // mostrando onde a pessoa estava depois que ela largou o trabalho
    roda('UPDATE couriers SET ultima_lat = NULL, ultima_lng = NULL WHERE id = ?', courierId);
  }
  return um('SELECT * FROM couriers WHERE id = ?', courierId);
}

/**
 * A fila do piloto.
 *
 * Duas listas de propósito: o que ja e dele (retirou e esta levando) e o
 * que esta pronto no balcao esperando alguem pegar. Misturar as duas faz
 * o entregador sair sem saber se a corrida e dele.
 */
export function fila(courier) {
  const minhas = todos(
    `SELECT o.id, o.codigo, o.status, o.total_centavos, o.separado_em, o.despachado_em,
            d.exige_maos, d.exige_termica, d.coletar_receita, d.status AS entrega_status,
            a.logradouro, a.numero, a.complemento, a.bairro, a.cidade, a.lat, a.lng,
            u.nome AS cliente, u.telefone,
            (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS itens
       FROM orders o
       JOIN deliveries d ON d.order_id = o.id
       JOIN addresses a ON a.id = o.address_id
       JOIN users u ON u.id = o.user_id
      WHERE d.courier_id = ? AND o.status = 'em_rota'
      ORDER BY o.despachado_em`, courier.id);

  const disponiveis = todos(
    `SELECT o.id, o.codigo, o.status, o.total_centavos, o.separado_em,
            d.exige_maos, d.exige_termica, d.coletar_receita,
            a.logradouro, a.numero, a.complemento, a.bairro, a.cidade, a.lat, a.lng,
            u.nome AS cliente, u.telefone,
            (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS itens
       FROM orders o
       JOIN deliveries d ON d.order_id = o.id
       JOIN addresses a ON a.id = o.address_id
       JOIN users u ON u.id = o.user_id
      WHERE o.pharmacy_id = ? AND o.status = 'pronto' AND d.courier_id IS NULL
      ORDER BY o.separado_em`, courier.pharmacy_id);

  return { minhas, disponiveis };
}

/**
 * Guarda uma posicao.
 *
 * Silenciosamente ignora se a loja desligou o rastreamento daquele
 * piloto — o app dele pode continuar mandando, mas nada e gravado. E
 * melhor descartar no servidor do que confiar que o cliente parou.
 */
export function registraPosicao(courierId, p) {
  const c = um('SELECT * FROM couriers WHERE id = ?', courierId);
  if (!c) throw new Erro(404, 'ENTREGADOR_INEXISTENTE', 'Entregador não encontrado');
  if (!c.rastreavel || !c.em_turno) return { gravado: false, motivo: 'rastreamento desligado' };

  const lat = Number(p.lat), lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Erro(422, 'COORDENADA_INVALIDA', 'Posição inválida');
  }
  // GPS de celular manda ponto com 2 km de erro quando esta sem sinal:
  // gravar isso faz a moto teleportar no mapa do cliente
  if (p.precisao_m && Number(p.precisao_m) > 200) {
    return { gravado: false, motivo: 'precisão baixa' };
  }

  roda(`INSERT INTO entregador_posicoes (id,courier_id,order_id,lat,lng,precisao_m,
          velocidade,rumo,bateria,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id(), courierId, p.order_id ?? null, lat, lng, p.precisao_m ?? null,
    p.velocidade ?? null, p.rumo ?? null, p.bateria ?? null, agora());
  roda('UPDATE couriers SET ultima_lat=?, ultima_lng=?, ultima_em=? WHERE id=?',
    lat, lng, agora(), courierId);

  // o cliente que espera aquele pedido ve a moto andar na hora
  for (const o of todos(
    `SELECT o.id, o.user_id FROM orders o JOIN deliveries d ON d.order_id = o.id
      WHERE d.courier_id = ? AND o.status = 'em_rota'`, courierId)) {
    publica(`user:${o.user_id}`, { tipo: 'entregador_moveu', order_id: o.id, lat, lng, rumo: p.rumo });
  }
  publica(`loja:${c.pharmacy_id}`, { tipo: 'entregador_moveu', courier_id: courierId, lat, lng });
  return { gravado: true };
}

/** Onde esta a moto daquele pedido. Só devolve se o rastreamento estiver ligado. */
export function posicaoDoPedido(orderId) {
  const r = um(
    `SELECT c.ultima_lat AS lat, c.ultima_lng AS lng, c.ultima_em, c.rastreavel,
            c.em_turno, c.nome, c.veiculo
       FROM deliveries d JOIN couriers c ON c.id = d.courier_id
      WHERE d.order_id = ?`, orderId);
  if (!r || !r.rastreavel || !r.em_turno || r.lat === null) return null;
  return r;
}

/** O rastro da entrega, para reconstruir uma corrida contestada. */
export const rastro = (orderId) => todos(
  `SELECT lat, lng, criado_em FROM entregador_posicoes
    WHERE order_id = ? ORDER BY criado_em`, orderId);

/**
 * Descarte do historico.
 *
 * Posicao de uma pessoa nao fica guardada para sempre "porque pode ser
 * util": 30 dias cobrem contestacao de entrega, que e o unico motivo
 * legitimo de manter.
 */
export const limpaRastros = (dias = 30) =>
  roda(`DELETE FROM entregador_posicoes WHERE criado_em < datetime('now', ?)`, `-${dias} days`);
