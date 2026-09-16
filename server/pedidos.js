import { um, todos, roda, id, agora, maisSegundos, transacao } from './db.js';
import { Erro } from './http.js';
import { transiciona, registra } from './state.js';
import { publica } from './events.js';
import * as pagamento from './pagamento.js';
import * as rx from './receituario.js';
import * as avaliacoes from './avaliacoes.js';
import { CONFIG } from './config.js';
import * as avisa from './notificacoes.js';
import * as interacoes from './interacoes.js';
import * as armario from './armario.js';
import * as estoque from './estoque.js';

const SEGUNDOS_PARA_ACEITAR = 90;

/** Lista curta dos itens, para quem pediu aviso detalhado. */
function nomesDosItens(orderId) {
  const itens = todos('SELECT nome_snapshot FROM order_items WHERE order_id = ?', orderId);
  if (!itens.length) return '';
  if (itens.length <= 2) return itens.map((i) => i.nome_snapshot).join(' e ');
  return `${itens[0].nome_snapshot} e mais ${itens.length - 1}`;
}

const solta = (p) => { try { p?.catch?.(() => {}); } catch {} };

/**
 * Código curto que o cliente lê no telefone: CV-4472.
 *
 * Nasceu como COUNT(*) + 4472 e isso quebra na primeira vez que a
 * numeração deixa de ser contínua — pedido apagado, base semeada com
 * histórico, importação. Agora anda a partir do maior código que existe.
 */
function proximoCodigo() {
  const ultimo = um(
    `SELECT MAX(CAST(substr(codigo, 4) AS INTEGER)) AS n FROM orders WHERE codigo LIKE 'CV-%'`).n;
  return 'CV-' + Math.max(4472, (ultimo ?? 0) + 1);
}

/**
 * Monta o carrinho contra UMA farmácia e devolve o orçamento já dividido
 * em "sai agora" e "aguarda farmacêutico". Não grava nada.
 */
export function orcamento({ pharmacyId, itens, socio = false, userId = null }) {
  const loja = um(`SELECT * FROM pharmacies WHERE id = ? AND status = 'ativa'`, pharmacyId);
  if (!loja) throw new Erro(404, 'LOJA_INDISPONIVEL', 'Farmácia não encontrada ou não está ativa');

  const linhas = [];
  for (const it of itens) {
    const p = um('SELECT * FROM products WHERE ean = ? AND ativo = 1', it.ean);
    if (!p) throw new Erro(404, 'PRODUTO_INEXISTENTE', `Produto ${it.ean} não existe no catálogo`);
    const regra = rx.regrasDoProduto(p);
    if (!regra.venda_remota) {
      throw new Erro(422, 'CONTROLADO_FORA_DA_PLATAFORMA', `${p.nome}: ${regra.motivo_bloqueio}`);
    }
    if (!CONFIG.receita_habilitada && regra.exige_receita) {
      throw new Erro(422, 'RECEITA_DESABILITADA',
        `${p.nome} exige receita. Por enquanto a Solmedic+ entrega só medicamento de venda livre.`);
    }
    const inv = um('SELECT * FROM inventory WHERE pharmacy_id = ? AND ean = ? AND ativo = 1', pharmacyId, it.ean);
    if (!inv) throw new Erro(409, 'SEM_NO_CATALOGO', `${p.nome} não é vendido por esta farmácia`);

    const disponivel = inv.estoque - inv.estoque_reservado;
    const preco = socio && inv.preco_socio_centavos ? inv.preco_socio_centavos : inv.preco_centavos;
    linhas.push({
      ean: p.ean, nome: p.nome, dosagem: p.dosagem, apresentacao: p.apresentacao,
      qtd: it.qtd, preco_unit_centavos: preco, preco_total_centavos: preco * it.qtd,
      requer_receita: regra.exige_receita ? 1 : 0, retem_receita: regra.exige_retencao ? 1 : 0,
      classe_receita: regra.classe, rotulo_classe: regra.rotulo,
      refrigerado: p.refrigerado, tarja: p.tarja,
      economia_centavos: Math.max(0, (inv.preco_centavos - preco) * it.qtd),
      disponivel, em_falta: disponivel < it.qtd,
    });
  }

  const subtotal = linhas.reduce((s, l) => s + l.preco_total_centavos, 0);
  const economia = linhas.reduce((s, l) => s + l.economia_centavos, 0);
  const frete = subtotal >= loja.frete_gratis_acima_centavos ? 0 : loja.frete_centavos;
  const comRx = linhas.filter((l) => l.requer_receita);
  const comRetencao = linhas.filter((l) => l.retem_receita);

  return {
    pharmacy: { id: loja.id, nome: loja.nome_fantasia, bairro: loja.bairro },
    grupos: {
      sai_agora: linhas.filter((l) => !l.requer_receita),
      aguarda_farmaceutico: comRx,
    },
    exige_receita: comRx.length > 0,
    exige_retencao: comRetencao.length > 0,
    // conferência de rótulo: a gente mostra, a pessoa decide
    alertas: interacoes.confere(userId, linhas.map((l) => l.ean)),
    // e o que já está na casa dela — vender de novo o que ela tem é
    // ganhar hoje e perder a confiança amanhã
    ja_tem: userId ? armario.jaTem(userId, linhas.map((l) => l.ean))
      .map((i) => ({ ean: i.ean, nome: i.nome, qtd: i.qtd_atual, validade: i.validade })) : [],
    exige_entrega_em_maos: comRx.length > 0,
    exige_caixa_termica: linhas.some((l) => l.refrigerado),
    subtotal_centavos: subtotal,
    frete_centavos: frete,
    economia_centavos: economia,
    total_centavos: subtotal + frete,
  };
}

/**
 * Cria o pedido: reserva estoque, autoriza (não cobra) e joga na fila da loja.
 * Tudo numa transação — estoque reservado sem pedido é bug que só aparece
 * na sexta à noite.
 */
export function cria({ user, addressId, pharmacyId, itens, metodo = 'cartao', cartaoFinal = '4417', prescriptionId = null }) {
  const orc = orcamento({ pharmacyId, itens, socio: !!user.socio, userId: user.id });
  const faltando = [...orc.grupos.sai_agora, ...orc.grupos.aguarda_farmaceutico].filter((l) => l.em_falta);
  if (faltando.length) {
    throw new Erro(409, 'SEM_ESTOQUE',
      `Sem estoque: ${faltando.map((f) => f.nome).join(', ')}`);
  }
  const end = um('SELECT * FROM addresses WHERE id = ? AND user_id = ?', addressId, user.id);
  if (!end) throw new Erro(404, 'ENDERECO_INVALIDO', 'Endereço não é seu ou não existe');

  const loja = um('SELECT * FROM pharmacies WHERE id = ?', pharmacyId);
  const oid = id();
  const codigo = proximoCodigo();
  const comissao = Math.round(orc.subtotal_centavos * (loja.comissao_pct / 100));

  return transacao(() => {
    roda(`INSERT INTO orders (id,codigo,user_id,pharmacy_id,address_id,status,
            subtotal_centavos,frete_centavos,desconto_centavos,total_centavos,
            comissao_pct,comissao_centavos,tem_receita,prazo_aceite_em,criado_em)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      oid, codigo, user.id, pharmacyId, addressId, 'criado',
      orc.subtotal_centavos, orc.frete_centavos, orc.economia_centavos, orc.total_centavos,
      loja.comissao_pct, comissao, orc.exige_receita ? 1 : 0,
      maisSegundos(SEGUNDOS_PARA_ACEITAR), agora());

    for (const l of [...orc.grupos.sai_agora, ...orc.grupos.aguarda_farmaceutico]) {
      let itemReceita = null;
      if (l.requer_receita) {
        itemReceita = achaSaldoDeReceita(user.id, l.ean, l.qtd, prescriptionId);
        if (!itemReceita) {
          throw new Erro(422, 'RECEITA_NECESSARIA',
            `${l.nome} precisa de receita válida com saldo. Envie a receita antes de fechar o pedido.`);
        }
      }
      roda(`INSERT INTO order_items (id,order_id,ean,nome_snapshot,dosagem_snapshot,qtd,
              preco_unit_centavos,preco_total_centavos,requer_receita,prescription_item_id,status)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        id(), oid, l.ean, l.nome, l.dosagem, l.qtd,
        l.preco_unit_centavos, l.preco_total_centavos, l.requer_receita ? 1 : 0,
        itemReceita?.id ?? null, 'pendente');

      roda(`UPDATE inventory SET estoque_reservado = estoque_reservado + ?
             WHERE pharmacy_id = ? AND ean = ?`, l.qtd, pharmacyId, l.ean);
    }

    // receita de papel sujeita a retenção: a via tem que voltar para a loja,
    // e quem traz é o entregador (RDC 471/2021 + prática aceita no delivery)
    const receitasUsadas = todos(
      `SELECT DISTINCT r.origem, r.exige_retencao FROM order_items oi
         JOIN prescription_items pi ON pi.id = oi.prescription_item_id
         JOIN prescriptions r ON r.id = pi.prescription_id
        WHERE oi.order_id = ?`, oid);
    const exigeColeta = receitasUsadas.some((r) => r.exige_retencao && r.origem === 'papel');
    if (exigeColeta) roda('UPDATE orders SET exige_coleta_receita = 1 WHERE id = ?', oid);

    roda(`INSERT INTO deliveries (id,order_id,status,exige_maos,exige_termica,coletar_receita)
          VALUES (?,?,?,?,?,?)`,
      id(), oid, 'aguardando', orc.exige_entrega_em_maos ? 1 : 0, orc.exige_caixa_termica ? 1 : 0,
      exigeColeta ? 1 : 0);

    // No cartão a reserva vale desde já. No PIX não existe reserva: o código
    // só nasce quando o pedido pode ser cobrado de verdade.
    // Cartão é autorizado na hora. PIX também ganha a linha agora — com
    // valor e nada capturado — porque sem ela o pedido não sabe que é PIX:
    // a tela não mostrava o QR e a separação capturava como se fosse cartão.
    pagamento.autoriza(oid, { metodo, cartaoFinal: metodo === 'pix' ? null : cartaoFinal,
      valor: orc.total_centavos });

    const ator = { tipo: 'cliente', id: user.id, nome: user.nome };
    registra(oid, null, 'criado', ator, { total_centavos: orc.total_centavos, autorizado: true });
    transiciona(oid, 'aguardando_loja', { tipo: 'sistema', nome: 'plataforma' });

    const pedido = detalhe(oid);
    publica(`loja:${pharmacyId}`, { tipo: 'pedido_novo', pedido });
    solta(avisa.paraLoja(pharmacyId, 'pedido_novo', {
      bairro: end.bairro, itens: pedido.itens.length,
      total: pedido.total_centavos, segundos: SEGUNDOS_PARA_ACEITAR,
    }));
    return pedido;
  });
}

/** Procura uma receita validada com saldo suficiente para o item. */
export function achaSaldoDeReceita(userId, ean, qtd, prescriptionId = null) {
  const p = um('SELECT * FROM products WHERE ean = ?', ean);
  return um(
    `SELECT pi.* FROM prescription_items pi
       JOIN prescriptions r ON r.id = pi.prescription_id
      WHERE r.user_id = ?
        -- pendente entra: o pedido pode ser criado e ESPERAR o farmacêutico.
        -- Quem impede a dispensa sem liberação é a máquina de estados, não esta busca.
        AND r.status IN ('pendente','validada')
        AND (r.valida_ate IS NULL OR r.valida_ate >= date('now'))
        AND (pi.ean = ? OR pi.principio_ativo = ?)
        AND (pi.qtd_prescrita - pi.qtd_usada) >= ?
        AND (? IS NULL OR r.id = ?)
      ORDER BY (r.status='validada') DESC, r.criado_em LIMIT 1`,
    userId, ean, p?.principio_ativo ?? '', qtd, prescriptionId, prescriptionId);
}

/** Pedido completo, do jeito que as telas precisam. */
export function detalhe(orderId) {
  const o = um('SELECT * FROM orders WHERE id = ?', orderId);
  if (!o) throw new Erro(404, 'PEDIDO_INEXISTENTE', 'Pedido não encontrado');
  // ordem do corredor: separar na ordem do carrinho faz o balconista
  // andar a loja inteira duas vezes
  const itens = todos(
    `SELECT oi.*, i.posicao FROM order_items oi
       LEFT JOIN orders o ON o.id = oi.order_id
       LEFT JOIN inventory i ON i.ean = oi.ean AND i.pharmacy_id = o.pharmacy_id
      WHERE oi.order_id = ?
      ORDER BY CASE WHEN i.posicao IS NULL THEN 1 ELSE 0 END, i.posicao`, orderId);
  return {
    ...o,
    itens,
    grupos: {
      sai_agora: itens.filter((i) => !i.requer_receita),
      aguarda_farmaceutico: itens.filter((i) => i.requer_receita),
    },
    pagamento: pagamento.doPedido(orderId),
    entrega: um('SELECT * FROM deliveries WHERE order_id = ?', orderId),
    entregador: um(
      `SELECT c.nome, c.veiculo, c.placa, c.caixa_termica FROM deliveries d
         JOIN couriers c ON c.id = d.courier_id WHERE d.order_id = ?`, orderId),
    ofertas: todos(`SELECT * FROM substitution_offers WHERE order_id = ? AND status = 'pendente'`, orderId),
    avaliacao: avaliacoes.doPedido(orderId),
    cliente: um('SELECT id, nome, telefone FROM users WHERE id = ?', o.user_id),
    // lat/lng entram aqui porque o mapa do acompanhamento é de verdade:
    // sem as duas pontas ele não tem o que desenhar
    farmacia: um(`SELECT id, nome_fantasia, bairro, cnpj, lat, lng
                    FROM pharmacies WHERE id = ?`, o.pharmacy_id),
    endereco: um('SELECT * FROM addresses WHERE id = ?', o.address_id),
    eventos: todos('SELECT * FROM order_events WHERE order_id = ? ORDER BY criado_em', orderId),
  };
}

/** A loja aceita. Se tem item tarjado, o pedido vai para a fila do farmacêutico. */
export function aceita(orderId, ator) {
  const o = um('SELECT * FROM orders WHERE id = ?', orderId);
  if (!o) throw new Erro(404, 'PEDIDO_INEXISTENTE', 'Pedido não encontrado');
  if (o.prazo_aceite_em && o.prazo_aceite_em < agora()) {
    cancela(orderId, { tipo: 'sistema', nome: 'plataforma' }, 'A loja não respondeu dentro do prazo');
    throw new Erro(409, 'PRAZO_EXPIRADO', 'O prazo de aceite estourou e o pedido foi cancelado');
  }
  roda(`UPDATE order_items SET status='confirmado' WHERE order_id = ? AND status='pendente'`, orderId);
  // Receita já validada antes vira saldo: não há passo humano novo a fazer.
  // Só espera o farmacêutico quem tem receita ainda pendente.
  const pendentes = um(
    `SELECT COUNT(*) AS n FROM order_items oi
       JOIN prescription_items pi ON pi.id = oi.prescription_item_id
       JOIN prescriptions r ON r.id = pi.prescription_id
      WHERE oi.order_id = ? AND r.status = 'pendente'`, orderId).n;
  transiciona(orderId, pendentes > 0 ? 'aguardando_receita' : 'em_separacao', ator);
  solta(avisa.paraCliente(o.user_id, 'aceito', o, { itens: nomesDosItens(orderId) }));
  return detalhe(orderId);
}

/** Item que a loja não tem. Não cancela o pedido — abre espaço pra contraproposta. */
export function marcaIndisponivel(orderId, itemId, ator) {
  const item = um('SELECT * FROM order_items WHERE id = ? AND order_id = ?', itemId, orderId);
  if (!item) throw new Erro(404, 'ITEM_INEXISTENTE', 'Item não está neste pedido');
  const o = um('SELECT * FROM orders WHERE id = ?', orderId);
  roda(`UPDATE order_items SET status='indisponivel' WHERE id = ?`, itemId);
  roda(`UPDATE inventory SET estoque_reservado = MAX(0, estoque_reservado - ?)
         WHERE pharmacy_id = ? AND ean = ?`, item.qtd, o.pharmacy_id, item.ean);
  registra(orderId, o.status, o.status, ator, { item: item.nome_snapshot, evento: 'indisponivel' });
  recalcula(orderId);
  return detalhe(orderId);
}

/** Ofereça no lugar, não cancele. */
export function ofereceSubstituto(orderId, itemId, eanOferecido, ator) {
  const item = um('SELECT * FROM order_items WHERE id = ? AND order_id = ?', itemId, orderId);
  if (!item) throw new Erro(404, 'ITEM_INEXISTENTE', 'Item não está neste pedido');
  const o = um('SELECT * FROM orders WHERE id = ?', orderId);
  const novo = um('SELECT * FROM products WHERE ean = ?', eanOferecido);
  if (!novo) throw new Erro(404, 'PRODUTO_INEXISTENTE', 'Produto oferecido não existe');
  const inv = um('SELECT * FROM inventory WHERE pharmacy_id = ? AND ean = ?', o.pharmacy_id, eanOferecido);
  if (!inv || inv.estoque - inv.estoque_reservado < item.qtd) {
    throw new Erro(409, 'SEM_ESTOQUE', 'Você também não tem estoque do substituto');
  }
  if (item.requer_receita && !novo.requer_receita === false) { /* mantém exigência */ }

  const preco = inv.preco_centavos * item.qtd;
  const oferta = {
    id: id(), order_id: orderId, order_item_id: itemId, ean_oferecido: eanOferecido,
    nome_oferecido: novo.nome, preco_centavos: preco,
    diferenca_centavos: preco - item.preco_total_centavos,
  };
  roda(`INSERT INTO substitution_offers (id,order_id,order_item_id,ean_oferecido,nome_oferecido,
          preco_centavos,diferenca_centavos,status,criado_em) VALUES (?,?,?,?,?,?,?,?,?)`,
    oferta.id, orderId, itemId, eanOferecido, novo.nome, preco, oferta.diferenca_centavos,
    'pendente', agora());
  registra(orderId, o.status, o.status, ator, { evento: 'contraproposta', oferece: novo.nome });
  if (o.status === 'em_separacao') transiciona(orderId, 'aguardando_cliente', ator);
  publica(`pedido:${orderId}`, { tipo: 'contraproposta', oferta });
  solta(avisa.paraCliente(o.user_id, 'contraproposta', o, { oferecido: novo.nome }));
  return detalhe(orderId);
}

/** O cliente responde à contraproposta. */
export function respondeOferta(orderId, ofertaId, aceita_, ator) {
  const of = um(`SELECT * FROM substitution_offers WHERE id = ? AND order_id = ? AND status='pendente'`,
    ofertaId, orderId);
  if (!of) throw new Erro(404, 'OFERTA_INEXISTENTE', 'Essa oferta não está mais aberta');
  const o = um('SELECT * FROM orders WHERE id = ?', orderId);

  if (aceita_) {
    roda(`UPDATE order_items SET status='substituido', substituido_por_ean=?,
            preco_unit_centavos=?, preco_total_centavos=? WHERE id=?`,
      of.ean_oferecido, Math.round(of.preco_centavos / Math.max(1, 1)), of.preco_centavos, of.order_item_id);
    roda(`UPDATE inventory SET estoque_reservado = estoque_reservado + 1
           WHERE pharmacy_id = ? AND ean = ?`, o.pharmacy_id, of.ean_oferecido);
  }
  roda(`UPDATE substitution_offers SET status=?, respondido_em=? WHERE id=?`,
    aceita_ ? 'aceito' : 'recusado', agora(), ofertaId);
  registra(orderId, o.status, o.status, ator,
    { evento: aceita_ ? 'substituicao_aceita' : 'substituicao_recusada', item: of.nome_oferecido });
  recalcula(orderId);
  if (o.status === 'aguardando_cliente') transiciona(orderId, 'em_separacao', ator);
  return detalhe(orderId);
}

/**
 * Recalcula o total considerando o que sobrou de verdade.
 * Item indisponível sai da conta; a captura no fim cobra só o que foi entregue.
 */
export function recalcula(orderId) {
  const o = um('SELECT * FROM orders WHERE id = ?', orderId);
  const validos = todos(
    `SELECT * FROM order_items WHERE order_id = ? AND status IN ('pendente','confirmado','substituido')`,
    orderId);
  const subtotal = validos.reduce((s, i) => s + i.preco_total_centavos, 0);
  const loja = um('SELECT * FROM pharmacies WHERE id = ?', o.pharmacy_id);
  const frete = subtotal >= loja.frete_gratis_acima_centavos ? 0 : loja.frete_centavos;
  const comissao = Math.round(subtotal * (o.comissao_pct / 100));
  roda(`UPDATE orders SET subtotal_centavos=?, frete_centavos=?, total_centavos=?, comissao_centavos=?
         WHERE id=?`, subtotal, frete, subtotal + frete, comissao, orderId);
  return um('SELECT * FROM orders WHERE id = ?', orderId);
}

/** Separado e conferido: aqui entra lote e validade, que é rastreabilidade. */
export function marcaPronto(orderId, ator, conferencia = []) {
  const ped = um('SELECT * FROM orders WHERE id = ?', orderId);
  // a caixa sai da prateleira agora: FEFO escolhe o lote, o bipado manda
  estoque.baixaSeparacao(ped.pharmacy_id, orderId, conferencia, ator?.id);
  const o = recalcula(orderId);
  // Captura é coisa de cartão. Pedido no PIX nasce SEM linha de pagamento
  // — ela só aparece quando o cliente gera a cobrança — e `pg` vem nulo:
  // o teste antigo (`pg?.metodo !== 'pix'`) dava verdadeiro nesse caso e
  // marcava como pago um PIX que ninguém tinha pagado.
  const pg = pagamento.doPedido(orderId);
  if (pg && pg.metodo !== 'pix') pagamento.captura(orderId, o.total_centavos);
  registra(orderId, o.status, o.status, ator, { evento: 'captura', valor_centavos: o.total_centavos });
  transiciona(orderId, 'pronto', ator);
  solta(avisa.paraCliente(o.user_id, 'conferindo', o, { itens: nomesDosItens(orderId) }));
  return detalhe(orderId);
}

/**
 * "Saiu para entrega".
 *
 * O botão do painel não pergunta qual motoboy — numa loja com dois
 * entregadores isso seria burocracia. Sem escolha explícita, pega o
 * entregador ativo da própria loja; se não houver nenhum, o pedido sai
 * assim mesmo e qualquer entregador pode assumir na tela dele.
 */
export function despacha(orderId, courierId, ator) {
  const o = um('SELECT * FROM orders WHERE id = ?', orderId);
  if (!o) throw new Erro(404, 'PEDIDO_INEXISTENTE', 'Pedido não encontrado');
  const d = um('SELECT * FROM deliveries WHERE order_id = ?', orderId);
  if (!d) throw new Erro(409, 'SEM_ENTREGA', 'Esse pedido não tem entrega registrada');

  const escolhido = courierId
    ?? um(`SELECT id FROM couriers WHERE pharmacy_id = ? AND ativo = 1 LIMIT 1`, o.pharmacy_id)?.id
    ?? null;

  roda(`UPDATE deliveries SET courier_id=?, status='retirada', atribuida_em=?, retirada_em=? WHERE id=?`,
    escolhido, agora(), agora(), d.id);
  transiciona(orderId, 'em_rota', ator);
  const p = detalhe(orderId);
  solta(avisa.paraCliente(p.user_id, 'saiu', p, {
    itens: nomesDosItens(orderId), entregador: p.entregador?.nome,
    eta: new Date(Date.now() + 14 * 60000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  }));
  return p;
}

export function entrega(orderId, { recebidoPor, doc, fotoUrl, receitaColetada = false }, ator) {
  const o = um('SELECT * FROM orders WHERE id = ?', orderId);
  const d = um('SELECT * FROM deliveries WHERE order_id = ?', orderId);
  if (d.exige_maos && !recebidoPor) {
    throw new Erro(422, 'EXIGE_ENTREGA_EM_MAOS',
      'Pedido com item sob receita não pode ficar na portaria — registre quem recebeu');
  }
  if (d.coletar_receita && !receitaColetada) {
    throw new Erro(422, 'EXIGE_COLETA_DA_RECEITA',
      'Este pedido tem item com retenção obrigatória: recolha a via da receita com o cliente '
      + 'antes de concluir. Ela precisa voltar para a farmácia.');
  }
  roda(`UPDATE deliveries SET status='entregue', entregue_em=?, recebido_por=?, doc_recebedor=?, foto_url=?,
          receita_coletada_em=? WHERE id=?`,
    agora(), recebidoPor ?? null, doc ?? null, fotoUrl ?? null,
    receitaColetada ? agora() : null, d.id);

  // o estoque já saiu da prateleira na separação; aqui só some a reserva
  for (const i of todos(`SELECT * FROM order_items WHERE order_id=? AND status IN ('confirmado','substituido')`, orderId)) {
    const ean = i.substituido_por_ean || i.ean;
    roda(`UPDATE inventory SET estoque_reservado = MAX(0, estoque_reservado - ?)
           WHERE pharmacy_id=? AND ean=?`, i.qtd, o.pharmacy_id, ean);
    if (i.prescription_item_id) {
      const pi = um('SELECT * FROM prescription_items WHERE id = ?', i.prescription_item_id);
      // receita com retenção é consumida quando a via é retida, não na entrega:
      // enquanto o papel não chega na loja, a dispensação não está fechada
      if (pi?.consumo !== 'integral') {
        roda(`UPDATE prescription_items SET qtd_usada = qtd_usada + ? WHERE id = ?`, i.qtd, i.prescription_item_id);
      }
      roda(`INSERT INTO prescription_uses (id,prescription_item_id,order_id,qtd,criado_em) VALUES (?,?,?,?,?)`,
        id(), i.prescription_item_id, orderId, i.qtd, agora());
    }
  }
  transiciona(orderId, 'entregue', ator);
  // o que saiu da loja entra no armário de quem recebeu, com lote e validade
  armario.guardaEntrega(orderId);
  solta(avisa.paraCliente(o.user_id, 'entregue', o));
  return detalhe(orderId);
}

/** Cancelar solta a reserva, devolve o que já tinha sido separado, e estorna. */
export function cancela(orderId, ator, motivo) {
  const o = um('SELECT * FROM orders WHERE id = ?', orderId);
  if (!o) throw new Erro(404, 'PEDIDO_INEXISTENTE', 'Pedido não encontrado');
  return transacao(() => {
    for (const i of todos(`SELECT * FROM order_items WHERE order_id=?`, orderId)) {
      roda(`UPDATE inventory SET estoque_reservado = MAX(0, estoque_reservado - ?)
             WHERE pharmacy_id=? AND ean=?`, i.qtd, o.pharmacy_id, i.ean);
    }
    // já tinha sido separado: a caixa volta para a prateleira
    if (o.separado_em) estoque.devolve(o.pharmacy_id, orderId, ator?.id);
    pagamento.estorna(orderId, motivo);
    transiciona(orderId, 'cancelado', ator, { motivo });
    solta(avisa.paraCliente(o.user_id, 'cancelado', o, { motivo }));
    return detalhe(orderId);
  });
}
