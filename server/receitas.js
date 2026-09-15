import { um, todos, roda, id, agora, transacao } from './db.js';
import { Erro } from './http.js';
import { transiciona, registra } from './state.js';
import { publica } from './events.js';
import { registraAcesso } from './auth.js';
import * as rx from './receituario.js';
import * as avisa from './notificacoes.js';

/**
 * O cliente manda a receita. Pode ser foto do papel ou prescrição
 * eletrônica assinada — e a diferença muda tudo o que vem depois.
 * Nada de OCR: quem lê é gente com CRF.
 */
export function envia({ user, arquivoUrl, itens = [], prescritor = {}, emitidaEm, validaAte,
                        usoContinuo = 0, origem = 'papel', plataforma = null,
                        codigoValidacao = null, tipoAssinatura = null, numeroSncr = null,
                        pharmacyId = null }) {
  if (origem === 'papel' && !arquivoUrl) throw new Erro(400, 'SEM_ARQUIVO', 'Envie a foto da receita');
  if (origem === 'eletronica' && !codigoValidacao) {
    throw new Erro(400, 'SEM_CODIGO', 'Informe o código de validação da prescrição eletrônica');
  }
  if (!['papel', 'eletronica'].includes(origem)) {
    throw new Erro(400, 'ORIGEM_INVALIDA', 'A receita é de papel ou eletrônica');
  }
  if (codigoValidacao && um('SELECT id FROM prescriptions WHERE plataforma IS ? AND codigo_validacao = ?',
      plataforma, codigoValidacao)) {
    throw new Erro(409, 'CODIGO_JA_USADO',
      'Essa prescrição eletrônica já foi registrada aqui. Uma receita não pode ser dispensada duas vezes.');
  }

  // a classe mais restritiva entre os itens manda no documento inteiro
  const produtos = itens.map((it) => it.ean ? um('SELECT * FROM products WHERE ean = ?', it.ean) : null).filter(Boolean);
  for (const p of produtos) {
    const r = rx.regrasDoProduto(p);
    if (!r.venda_remota) throw new Erro(422, 'CONTROLADO_FORA_DA_PLATAFORMA', `${p.nome}: ${r.motivo_bloqueio}`);
  }
  const classes = produtos.map(rx.classificaProduto);
  const classe = classes.includes('branca_retida') ? 'branca_retida'
    : classes.includes('branca_simples') ? 'branca_simples' : 'branca_simples';

  const aceite = rx.aceitaOrigem({ classe, origem, tipo_assinatura: tipoAssinatura });
  if (!aceite.ok) throw new Erro(422, 'ASSINATURA_INSUFICIENTE', aceite.motivo);

  const exigeRetencao = classes.some((c) => rx.CLASSES[c].exige_retencao);
  const vencimento = validaAte ?? rx.validadeAte(classe, emitidaEm, !!usoContinuo);

  const rid = id();
  return transacao(() => {
    roda(`INSERT INTO prescriptions (id,user_id,arquivo_url,prescritor_nome,prescritor_crm,prescritor_uf,
            emitida_em,valida_ate,uso_continuo,status,criado_em,
            origem,plataforma,codigo_validacao,tipo_assinatura,assinatura_validada,numero_sncr,exige_retencao,
            pharmacy_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      rid, user.id, arquivoUrl ?? null, prescritor.nome ?? null, prescritor.crm ?? null, prescritor.uf ?? null,
      emitidaEm ?? null, vencimento, usoContinuo ? 1 : 0, 'pendente', agora(),
      origem, plataforma, codigoValidacao, tipoAssinatura,
      // assinatura eletrônica é conferida pelo farmacêutico na liberação
      0, numeroSncr, exigeRetencao ? 1 : 0, pharmacyId);

    for (const it of itens) {
      const p = it.ean ? um('SELECT * FROM products WHERE ean = ?', it.ean) : null;
      const consumo = p ? rx.CLASSES[rx.classificaProduto(p)].consumo : 'saldo';
      roda(`INSERT INTO prescription_items (id,prescription_id,ean,principio_ativo,dosagem,posologia,
              qtd_prescrita,consumo) VALUES (?,?,?,?,?,?,?,?)`,
        id(), rid, it.ean ?? null, it.principio_ativo ?? p?.principio_ativo ?? null,
        it.dosagem ?? p?.dosagem ?? null, it.posologia ?? null, it.qtd_prescrita ?? 1, consumo);
    }
    return detalhe(rid);
  });
}

export function detalhe(rid) {
  const r = um('SELECT * FROM prescriptions WHERE id = ?', rid);
  if (!r) throw new Erro(404, 'RECEITA_INEXISTENTE', 'Receita não encontrada');
  const itens = todos('SELECT * FROM prescription_items WHERE prescription_id = ?', rid).map((i) => ({
    ...i,
    saldo: i.consumo === 'integral' ? (i.qtd_usada > 0 ? 0 : i.qtd_prescrita) : i.qtd_prescrita - i.qtd_usada,
  }));
  const vencida = !!(r.valida_ate && r.valida_ate < new Date().toISOString().slice(0, 10));
  return {
    ...r, itens, vencida,
    retencoes: todos('SELECT * FROM prescription_retentions WHERE prescription_id = ? ORDER BY criado_em', rid),
    precisa_via_fisica: !!r.exige_retencao && r.origem === 'papel' && !r.retida_em,
  };
}

export function doCliente(userId) {
  return todos('SELECT id FROM prescriptions WHERE user_id = ? ORDER BY criado_em DESC', userId)
    .map((r) => detalhe(r.id));
}

/** Fila do farmacêutico: receitas de pedidos desta loja esperando conferência. */
export function fila(pharmacyId) {
  // duas portas de entrada: receita anexada a um pedido desta loja, e
  // receita que o cliente mandou solta para esta loja ler — sem a segunda,
  // a promessa de "a receita fica guardada com saldo" nunca acontece
  return todos(
    `SELECT DISTINCT r.id, r.criado_em FROM prescriptions r
      WHERE r.status = 'pendente' AND (
        r.pharmacy_id = ?
        OR EXISTS (SELECT 1 FROM prescription_items pi
                     JOIN order_items oi ON oi.prescription_item_id = pi.id
                     JOIN orders o ON o.id = oi.order_id
                    WHERE pi.prescription_id = r.id AND o.pharmacy_id = ?))
      ORDER BY r.criado_em`, pharmacyId, pharmacyId).map((r) => detalhe(r.id));
}

/** Receitas já liberadas cuja via de papel ainda não voltou para a loja. */
export function filaRetencao(pharmacyId) {
  return todos(
    `SELECT DISTINCT r.id
       FROM prescriptions r
       JOIN prescription_items pi ON pi.prescription_id = r.id
       JOIN order_items oi        ON oi.prescription_item_id = pi.id
       JOIN orders o              ON o.id = oi.order_id
      WHERE o.pharmacy_id = ? AND r.status = 'validada'
        AND r.exige_retencao = 1 AND r.origem = 'papel' AND r.retida_em IS NULL
      ORDER BY r.validada_em`, pharmacyId).map((r) => detalhe(r.id));
}

/**
 * O farmacêutico lê o papel e preenche o que a foto não diz.
 * Sem isso a receita não tem medicamento, dose nem quantidade — e
 * sem esses três não existe dispensação.
 */
export function preenche(rid, { prescritor = {}, emitidaEm, itens = [], usoContinuo }, { u }) {
  const r = um('SELECT * FROM prescriptions WHERE id = ?', rid);
  if (!r) throw new Erro(404, 'RECEITA_INEXISTENTE', 'Receita não encontrada');
  if (r.status !== 'pendente') throw new Erro(409, 'JA_AVALIADA', 'Essa receita já foi avaliada');

  return transacao(() => {
    const produtos = itens.map((it) => um('SELECT * FROM products WHERE ean = ?', it.ean)).filter(Boolean);
    for (const p of produtos) {
      const regra = rx.regrasDoProduto(p);
      if (!regra.venda_remota) throw new Erro(422, 'CONTROLADO_FORA_DA_PLATAFORMA', `${p.nome}: ${regra.motivo_bloqueio}`);
    }
    const classes = produtos.map(rx.classificaProduto);
    const classe = classes.includes('branca_retida') ? 'branca_retida' : 'branca_simples';
    const exigeRetencao = classes.some((c) => rx.CLASSES[c].exige_retencao);
    const contInuo = usoContinuo ?? r.uso_continuo;
    const vencimento = rx.validadeAte(classe, emitidaEm ?? r.emitida_em, !!contInuo);

    roda(`UPDATE prescriptions SET prescritor_nome=?, prescritor_crm=?, prescritor_uf=?,
            emitida_em=?, valida_ate=?, uso_continuo=?, exige_retencao=? WHERE id=?`,
      prescritor.nome ?? r.prescritor_nome, prescritor.crm ?? r.prescritor_crm,
      prescritor.uf ?? r.prescritor_uf, emitidaEm ?? r.emitida_em, vencimento,
      contInuo ? 1 : 0, exigeRetencao ? 1 : 0, rid);

    if (itens.length) {
      roda(`DELETE FROM prescription_items WHERE prescription_id = ?
              AND id NOT IN (SELECT prescription_item_id FROM order_items
                             WHERE prescription_item_id IS NOT NULL)`, rid);
      for (const it of itens) {
        const p = um('SELECT * FROM products WHERE ean = ?', it.ean);
        const consumo = p ? rx.CLASSES[rx.classificaProduto(p)].consumo : 'saldo';
        roda(`INSERT INTO prescription_items (id,prescription_id,ean,principio_ativo,dosagem,posologia,
                qtd_prescrita,consumo) VALUES (?,?,?,?,?,?,?,?)`,
          id(), rid, it.ean, it.principio_ativo ?? p?.principio_ativo ?? null,
          it.dosagem ?? p?.dosagem ?? null, it.posologia ?? null, it.qtd_prescrita ?? 1, consumo);
      }
    }
    registraAcesso(u.id, 'prescription', rid, 'preenchimento', null);
    return detalhe(rid);
  });
}

/**
 * A liberação. Único passo humano obrigatório do sistema, e o único ponto
 * onde o nome e o CRF de alguém ficam colados no pedido.
 * Receita eletrônica assinada é retida aqui mesmo, no ato — digitalmente.
 * Receita de papel só estará retida quando a via chegar na loja.
 */
export function libera(rid, { u, vinculo }, pharmacyId, ip) {
  const r = detalhe(rid);
  if (r.status !== 'pendente') throw new Erro(409, 'JA_AVALIADA', 'Essa receita já foi avaliada');
  if (!r.itens.length) {
    throw new Erro(422, 'RECEITA_SEM_ITENS',
      'Preencha o medicamento, a dose e a quantidade antes de liberar');
  }
  if (r.vencida) {
    throw new Erro(422, 'RECEITA_VENCIDA',
      `Receita vencida em ${r.valida_ate}. Antimicrobiano vale 10 dias da emissão.`);
  }
  if (r.origem === 'eletronica' && !r.codigo_validacao) {
    throw new Erro(422, 'SEM_CODIGO', 'Prescrição eletrônica sem código de validação');
  }

  const crf = `${vinculo.crf}-${vinculo.crf_uf ?? ''}`.replace(/-$/, '');
  roda(`UPDATE prescriptions SET status='validada', validada_por=?, validada_crf=?, validada_em=?,
          assinatura_validada=? WHERE id=?`,
    u.id, crf, agora(), r.origem === 'eletronica' ? 1 : 0, rid);
  registraAcesso(u.id, 'prescription', rid, 'aprovacao', ip);

  // eletrônica: a baixa é digital e acontece agora
  if (r.origem === 'eletronica' && r.exige_retencao) {
    gravaRetencao({ rid, pharmacyId, u, crf, via: 'digital',
      dados: { observacao: `Baixa na plataforma ${r.plataforma ?? 'emissora'}, código ${r.codigo_validacao}` } });
  }

  const ator = { tipo: 'farmaceutico', id: u.id, nome: u.nome };
  for (const o of pedidosEsperando(rid, pharmacyId)) {
    registra(o.id, o.status, o.status, ator, { evento: 'receita_liberada', crf });
    // papel com retenção: o entregador vai ter que trazer a via
    if (r.exige_retencao && r.origem === 'papel') {
      roda('UPDATE orders SET exige_coleta_receita = 1 WHERE id = ?', o.id);
      roda('UPDATE deliveries SET coletar_receita = 1 WHERE order_id = ?', o.id);
    }
    transiciona(o.id, 'em_separacao', ator);
  }
  publica(`receita:${rid}`, { tipo: 'validada', receita: detalhe(rid) });
  for (const o of todos(`SELECT DISTINCT o.* FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN prescription_items pi ON pi.id = oi.prescription_item_id
     WHERE pi.prescription_id = ?`, rid)) {
    avisa.paraCliente(o.user_id, 'receita_liberada', o).catch(() => {});
  }
  return detalhe(rid);
}

/** Recusa SEMPRE com motivo escrito — recusa muda vira reclamação. */
export function recusa(rid, motivo, { u, vinculo }, pharmacyId, ip) {
  if (!motivo || motivo.trim().length < 5) {
    throw new Erro(422, 'MOTIVO_OBRIGATORIO',
      'Escreva o motivo da recusa: o cliente precisa saber o que corrigir');
  }
  const r = um('SELECT * FROM prescriptions WHERE id = ?', rid);
  if (!r) throw new Erro(404, 'RECEITA_INEXISTENTE', 'Receita não encontrada');
  roda(`UPDATE prescriptions SET status='recusada', validada_por=?, validada_em=?, motivo_recusa=? WHERE id=?`,
    u.id, agora(), motivo, rid);
  registraAcesso(u.id, 'prescription', rid, 'recusa', ip);

  const ator = { tipo: 'farmaceutico', id: u.id, nome: u.nome };
  for (const o of pedidosEsperando(rid, pharmacyId)) {
    registra(o.id, o.status, o.status, ator, { evento: 'receita_recusada', motivo });
  }
  publica(`receita:${rid}`, { tipo: 'recusada', motivo });
  return detalhe(rid);
}

/**
 * O registro da retenção — a prova de que a dispensação aconteceu direito.
 * Orientação do CFF: anotar registro, quantidade dispensada, lote e validade,
 * e arquivar. É exatamente o que estes campos guardam.
 */
export function registraRetencao(rid, dados, { u, vinculo }, pharmacyId, ip) {
  const r = detalhe(rid);
  if (r.status !== 'validada') {
    throw new Erro(409, 'RECEITA_NAO_VALIDADA', 'Libere a receita antes de registrar a retenção');
  }
  if (r.retida_em) throw new Erro(409, 'JA_RETIDA', 'Essa receita já consta como retida');
  if (!dados.quantidade_dispensada) {
    throw new Erro(422, 'QUANTIDADE_OBRIGATORIA', 'Informe a quantidade dispensada');
  }
  if (!dados.lote) throw new Erro(422, 'LOTE_OBRIGATORIO', 'Informe o lote dispensado');

  const crf = `${vinculo.crf}-${vinculo.crf_uf ?? ''}`.replace(/-$/, '');
  gravaRetencao({ rid, pharmacyId, u, crf, via: 'fisica', dados });
  registraAcesso(u.id, 'prescription', rid, 'retencao', ip);
  return detalhe(rid);
}

function gravaRetencao({ rid, pharmacyId, u, crf, via, dados = {} }) {
  const pedidos = todos(
    `SELECT DISTINCT o.id FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN prescription_items pi ON pi.id = oi.prescription_item_id
      WHERE pi.prescription_id = ? AND o.pharmacy_id = ?`, rid, pharmacyId);

  transacao(() => {
    roda(`INSERT INTO prescription_retentions (id,prescription_id,order_id,pharmacy_id,farmaceutico_id,
            crf,via,recebida_em,registro_numero,quantidade_dispensada,lote,validade_lote,
            arquivo_url,observacao,criado_em)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id(), rid, pedidos[0]?.id ?? null, pharmacyId, u.id, crf, via, agora(),
      dados.registro_numero ?? null, dados.quantidade_dispensada ?? null, dados.lote ?? null,
      dados.validade_lote ?? null, dados.arquivo_url ?? null, dados.observacao ?? null, agora());

    roda(`UPDATE prescriptions SET retida=1, retida_em=?, retida_por=?, retida_via=? WHERE id=?`,
      agora(), u.id, via, rid);

    // receita retida é consumida inteira: não sobra saldo para um segundo pedido
    roda(`UPDATE prescription_items SET qtd_usada = qtd_prescrita
           WHERE prescription_id = ? AND consumo = 'integral'`, rid);

    for (const o of pedidos) roda('UPDATE orders SET receita_retida = 1 WHERE id = ?', o.id);
  });
  publica(`receita:${rid}`, { tipo: 'retida', via });
}

function pedidosEsperando(rid, pharmacyId) {
  return todos(
    `SELECT DISTINCT o.* FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN prescription_items pi ON pi.id = oi.prescription_item_id
      WHERE pi.prescription_id = ? AND o.pharmacy_id = ? AND o.status = 'aguardando_receita'`,
    rid, pharmacyId);
}
