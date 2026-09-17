import { um, todos, roda, id, agora, transacao } from './db.js';
import { Erro } from './http.js';
import { hashSenha } from './auth.js';
// 'estoque' é nome de parâmetro em defineItem: o apelido evita o sombreamento
import * as lotes from './estoque.js';

/** Sem esses seis papéis, a loja não vende. É o escudo jurídico da plataforma. */
export const DOCS_OBRIGATORIOS = [
  'alvara_sanitario', 'afe_anvisa', 'crf_responsavel',
  'contrato_social', 'cnpj_cartao', 'conta_bancaria',
  // a RDC 44/2009 exige que o endereço do site que recebe o pedido conste
  // na AFE da farmácia. Num marketplace, o site é o NOSSO domínio —
  // cada loja precisa aditar a AFE dela antes de vender aqui.
  'aditivo_afe_dominio',
];

export const ROTULO_DOC = {
  alvara_sanitario: 'Alvará sanitário',
  afe_anvisa: 'AFE — Autorização de Funcionamento (Anvisa)',
  crf_responsavel: 'CRF do responsável técnico',
  contrato_social: 'Contrato social',
  cnpj_cartao: 'Cartão CNPJ',
  conta_bancaria: 'Dados bancários',
  aditivo_afe_dominio: 'AFE com o domínio da plataforma',
};

/** Autocadastro: a farmácia entra sozinha, em rascunho. */
export function cadastra(dados) {
  const { cnpj, razao_social, nome_fantasia, gerente } = dados;
  if (!cnpj || !razao_social || !nome_fantasia) {
    throw new Erro(400, 'DADOS_INCOMPLETOS', 'CNPJ, razão social e nome fantasia são obrigatórios');
  }
  if (um('SELECT id FROM pharmacies WHERE cnpj = ?', cnpj)) {
    throw new Erro(409, 'CNPJ_JA_CADASTRADO', 'Já existe uma farmácia com esse CNPJ');
  }
  return transacao(() => {
    const pid = id();
    roda(`INSERT INTO pharmacies (id,razao_social,nome_fantasia,cnpj,telefone,email,
            logradouro,numero,bairro,cidade,uf,cep,lat,lng,status,criado_em)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      pid, razao_social, nome_fantasia, cnpj, dados.telefone ?? null, dados.email ?? null,
      dados.logradouro ?? null, dados.numero ?? null, dados.bairro ?? null,
      dados.cidade ?? 'Fortaleza', dados.uf ?? 'CE', dados.cep ?? null,
      dados.lat ?? null, dados.lng ?? null, 'rascunho', agora());

    for (let d = 0; d < 7; d++) {
      roda(`INSERT INTO pharmacy_hours (pharmacy_id,dia_semana,abre,fecha,is_24h,fechado)
            VALUES (?,?,?,?,?,?)`, pid, d, '08:00', '22:00', 0, 0);
    }

    if (gerente?.email) {
      let u = um('SELECT * FROM users WHERE email = ?', gerente.email);
      if (!u) {
        const uid = id();
        roda(`INSERT INTO users (id,nome,email,telefone,senha_hash,papel_global,criado_em)
              VALUES (?,?,?,?,?,?,?)`,
          uid, gerente.nome, gerente.email, gerente.telefone ?? null,
          hashSenha(gerente.senha ?? 'trocar123'), 'cliente', agora());
        u = um('SELECT * FROM users WHERE id = ?', uid);
      }
      roda(`INSERT INTO pharmacy_users (id,pharmacy_id,user_id,papel,ativo,criado_em)
            VALUES (?,?,?,?,?,?)`, id(), pid, u.id, 'gerente', 1, agora());
    }
    return ficha(pid);
  });
}

export function ficha(pid) {
  const p = um('SELECT * FROM pharmacies WHERE id = ?', pid);
  if (!p) throw new Erro(404, 'LOJA_INEXISTENTE', 'Farmácia não encontrada');
  const docs = todos('SELECT * FROM pharmacy_docs WHERE pharmacy_id = ? ORDER BY tipo', pid);
  const entregues = new Set(docs.filter((d) => d.status !== 'recusado').map((d) => d.tipo));
  return {
    ...p,
    docs,
    docs_faltando: DOCS_OBRIGATORIOS.filter((t) => !entregues.has(t)),
    horarios: todos('SELECT * FROM pharmacy_hours WHERE pharmacy_id = ? ORDER BY dia_semana', pid),
    equipe: todos(`SELECT pu.*, u.nome, u.email FROM pharmacy_users pu
                     JOIN users u ON u.id = pu.user_id
                    WHERE pu.pharmacy_id = ? AND pu.ativo = 1`, pid),
    skus: um('SELECT COUNT(*) AS n FROM inventory WHERE pharmacy_id = ?', pid).n,
    rotulos_doc: ROTULO_DOC,
  };
}

export function anexaDoc(pid, { tipo, numero, validade, arquivo_url, dominio }) {
  if (!DOCS_OBRIGATORIOS.includes(tipo)) {
    throw new Erro(400, 'TIPO_INVALIDO', `Documento desconhecido: ${tipo}`);
  }
  if (tipo === 'aditivo_afe_dominio') {
    if (!dominio) {
      throw new Erro(422, 'DOMINIO_OBRIGATORIO',
        'Informe o domínio que consta na AFE — é ele que autoriza a loja a receber pedido por aqui');
    }
    roda('UPDATE pharmacies SET dominio_afe = ? WHERE id = ?', dominio, pid);
  }
  roda(`DELETE FROM pharmacy_docs WHERE pharmacy_id = ? AND tipo = ? AND status = 'pendente'`, pid, tipo);
  roda(`INSERT INTO pharmacy_docs (id,pharmacy_id,tipo,numero,validade,arquivo_url,status,criado_em)
        VALUES (?,?,?,?,?,?,?,?)`,
    id(), pid, tipo, numero ?? null, validade ?? null, arquivo_url ?? null, 'pendente', agora());
  return ficha(pid);
}

/** Só entra em análise com a papelada completa. */
export function submete(pid) {
  const f = ficha(pid);
  if (f.docs_faltando.length) {
    throw new Erro(422, 'DOCUMENTOS_FALTANDO',
      `Faltam documentos: ${f.docs_faltando.join(', ')}`);
  }
  if (!f.equipe.some((e) => e.papel === 'farmaceutico' && e.crf)) {
    throw new Erro(422, 'SEM_RESPONSAVEL_TECNICO',
      'Cadastre o farmacêutico responsável técnico com CRF antes de enviar');
  }
  roda(`UPDATE pharmacies SET status='em_analise' WHERE id=?`, pid);
  return ficha(pid);
}

export function decide(pid, aprovar, motivo, adminId) {
  const f = ficha(pid);
  if (f.status !== 'em_analise') {
    throw new Erro(409, 'FORA_DE_ANALISE', 'Essa farmácia não está em análise');
  }
  if (aprovar) {
    roda(`UPDATE pharmacy_docs SET status='aprovado', revisado_por=?, revisado_em=? WHERE pharmacy_id=?`,
      adminId, agora(), pid);
    roda(`UPDATE pharmacies SET status='ativa', aprovado_em=?, motivo_status=NULL WHERE id=?`, agora(), pid);
  } else {
    if (!motivo) throw new Erro(422, 'MOTIVO_OBRIGATORIO', 'Diga por que está recusando');
    roda(`UPDATE pharmacies SET status='recusada', motivo_status=? WHERE id=?`, motivo, pid);
  }
  return ficha(pid);
}

export function adicionaMembro(pid, { nome, email, senha, papel, crf, crf_uf, responsavel_tecnico }) {
  if (papel === 'farmaceutico' && !crf) {
    throw new Erro(422, 'CRF_OBRIGATORIO', 'Farmacêutico sem CRF não pode liberar receita');
  }
  let u = um('SELECT * FROM users WHERE email = ?', email);
  if (!u) {
    const uid = id();
    roda(`INSERT INTO users (id,nome,email,senha_hash,papel_global,criado_em) VALUES (?,?,?,?,?,?)`,
      uid, nome, email, hashSenha(senha ?? 'trocar123'), 'cliente', agora());
    u = um('SELECT * FROM users WHERE id = ?', uid);
  }
  roda(`INSERT OR REPLACE INTO pharmacy_users
          (id,pharmacy_id,user_id,papel,crf,crf_uf,responsavel_tecnico,ativo,criado_em)
        VALUES (?,?,?,?,?,?,?,?,?)`,
    id(), pid, u.id, papel, crf ?? null, crf_uf ?? null, responsavel_tecnico ? 1 : 0, 1, agora());
  return ficha(pid);
}

// ---------- catálogo da loja: o preço é por farmácia ----------
export function catalogo(pid, { q = '', limite = 200 } = {}) {
  return todos(
    `SELECT p.*, i.preco_centavos, i.preco_socio_centavos, i.estoque, i.estoque_reservado, i.ativo AS ativo_na_loja
       FROM inventory i JOIN products p ON p.ean = i.ean
      WHERE i.pharmacy_id = ?
        AND (? = '' OR p.nome LIKE ? OR p.principio_ativo LIKE ? OR p.ean = ?)
      ORDER BY p.nome LIMIT ?`,
    pid, q, `%${q}%`, `%${q}%`, q, limite);
}

export function defineItem(pid, { ean, preco_centavos, preco_socio_centavos, estoque, ativo = 1, posicao }) {
  const p = um('SELECT * FROM products WHERE ean = ?', ean);
  const antes = um('SELECT * FROM inventory WHERE pharmacy_id=? AND ean=?', pid, ean);
  if (!p) throw new Erro(404, 'PRODUTO_INEXISTENTE', `EAN ${ean} não existe no catálogo mestre`);
  if (p.controlado_344) {
    throw new Erro(422, 'CONTROLADO_FORA_DA_PLATAFORMA',
      'Medicamento da Portaria 344 não pode ser vendido por delivery');
  }
  if (p.pmc_centavos && preco_centavos > p.pmc_centavos) {
    throw new Erro(422, 'ACIMA_DO_PMC',
      `R$ ${(preco_centavos / 100).toFixed(2)} passa o preço máximo ao consumidor (R$ ${(p.pmc_centavos / 100).toFixed(2)})`);
  }
  roda(`INSERT INTO inventory (pharmacy_id,ean,preco_centavos,preco_socio_centavos,estoque,ativo,posicao,atualizado_em)
        VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(pharmacy_id,ean) DO UPDATE SET
          preco_centavos=excluded.preco_centavos,
          preco_socio_centavos=excluded.preco_socio_centavos,
          estoque=excluded.estoque, ativo=excluded.ativo,
          posicao=COALESCE(excluded.posicao, inventory.posicao),
          atualizado_em=excluded.atualizado_em`,
    pid, ean, preco_centavos, preco_socio_centavos ?? null, estoque ?? 0, ativo ? 1 : 0,
    posicao ?? null, agora());
  // mexer no estoque pela tela do catálogo continua valendo, mas não em
  // silêncio: a diferença entra no kardex como ajuste, igual a qualquer outra
  const depois = um(`SELECT * FROM inventory WHERE pharmacy_id=? AND ean=?`, pid, ean);
  const dif = depois.estoque - (antes?.estoque ?? 0);
  if (dif !== 0) {
    roda(`INSERT INTO estoque_mov (id,pharmacy_id,ean,tipo,qtd,saldo_depois,motivo,criado_em)
          VALUES (?,?,?,'ajuste',?,?,?,?)`,
      id(), pid, ean, dif, depois.estoque, 'editado na tela do catálogo', agora());
    // e os lotes acompanham, senão as duas camadas brigam para sempre
    lotes.sincronizaLotes(pid, ean, dif);
  }
  return depois;
}

/**
 * Importação por CSV — é assim que a loja sobe o estoque no começo,
 * antes de existir integração com Trier ou Inovafarma.
 * Formato: ean;preco;preco_socio;estoque
 */
export function importaCSV(pid, texto) {
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rel = { total: 0, ok: 0, erros: [] };
  for (const [n, linha] of linhas.entries()) {
    if (n === 0 && /ean/i.test(linha)) continue;
    rel.total++;
    const [ean, preco, socio, estoque] = linha.split(/[;,\t]/).map((c) => c?.trim());
    try {
      defineItem(pid, {
        ean,
        preco_centavos: Math.round(parseFloat(String(preco).replace(',', '.')) * 100),
        preco_socio_centavos: socio ? Math.round(parseFloat(String(socio).replace(',', '.')) * 100) : null,
        estoque: parseInt(estoque || '0', 10),
      });
      rel.ok++;
    } catch (e) {
      rel.erros.push({ linha: n + 1, ean, erro: e.message });
    }
  }
  return rel;
}

// ---------- o que a loja precisa ver todo dia ----------
export function indicadores(pid) {
  const hoje = new Date().toISOString().slice(0, 10);
  const pedidosHoje = todos(`SELECT * FROM orders WHERE pharmacy_id=? AND criado_em >= ?`, pid, hoje);
  const entregues = pedidosHoje.filter((o) => o.status === 'entregue');
  // conta a ruptura mesmo quando foi resolvida com substituição:
  // o que interessa saber é que o estoque furou, não se deu pra contornar
  const comFalta = todos(
    `SELECT DISTINCT o.id FROM orders o JOIN order_events e ON e.order_id=o.id
      WHERE o.pharmacy_id=? AND o.criado_em >= ? AND e.detalhe LIKE '%indisponivel%'`, pid, hoje);

  const tempos = entregues
    .filter((o) => o.aceito_em && o.separado_em)
    .map((o) => (Date.parse(o.separado_em) - Date.parse(o.aceito_em)) / 1000);

  return {
    pedidos_hoje: pedidosHoje.length,
    entregues_hoje: entregues.length,
    cancelados_hoje: pedidosHoje.filter((o) => o.status === 'cancelado').length,
    // a única métrica que decide se o produto existe
    ruptura_pct: pedidosHoje.length ? +(comFalta.length / pedidosHoje.length * 100).toFixed(1) : 0,
    separacao_media_seg: tempos.length ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length) : null,
    bruto_centavos: entregues.reduce((s, o) => s + o.total_centavos, 0),
    comissao_centavos: entregues.reduce((s, o) => s + o.comissao_centavos, 0),
    a_receber_centavos: entregues.reduce((s, o) => s + (o.total_centavos - o.comissao_centavos), 0),
    fila: todos(`SELECT COUNT(*) AS n FROM orders WHERE pharmacy_id=? AND status='aguardando_loja'`, pid).at(0).n,
    receitas_na_fila: um(
      `SELECT COUNT(DISTINCT r.id) AS n FROM prescriptions r
         JOIN prescription_items pi ON pi.prescription_id=r.id
         JOIN order_items oi ON oi.prescription_item_id=pi.id
         JOIN orders o ON o.id=oi.order_id
        WHERE o.pharmacy_id=? AND r.status='pendente'`, pid).n,
    estoque_zerado: um(
      `SELECT COUNT(*) AS n FROM inventory WHERE pharmacy_id=? AND ativo=1 AND estoque<=0`, pid).n,
    // vias de papel que saíram e ainda não voltaram para o arquivo da loja
    ruptura_prevista: previsaoDeRuptura(pid).length,
    retencoes_pendentes: um(
      `SELECT COUNT(DISTINCT r.id) AS n FROM prescriptions r
         JOIN prescription_items pi ON pi.prescription_id = r.id
         JOIN order_items oi ON oi.prescription_item_id = pi.id
         JOIN orders o ON o.id = oi.order_id
        WHERE o.pharmacy_id = ? AND r.status='validada'
          AND r.exige_retencao = 1 AND r.origem='papel' AND r.retida_em IS NULL`, pid).n,
  };
}

/**
 * Quantos dias faltam para zerar, no ritmo das últimas duas semanas.
 * "Acabou" é o aviso que chega tarde; "acaba quinta" dá tempo de comprar.
 */
export function previsaoDeRuptura(pid, limiteDias = 5) {
  const linhas = todos(
    `SELECT i.ean, p.nome, i.estoque, i.posicao,
            COALESCE(SUM(oi.qtd), 0) AS vendidos
       FROM inventory i
       JOIN products p ON p.ean = i.ean
       LEFT JOIN order_items oi ON oi.ean = i.ean
            AND oi.order_id IN (SELECT id FROM orders WHERE pharmacy_id = i.pharmacy_id
                 AND status = 'entregue' AND entregue_em >= datetime('now','-14 days'))
      WHERE i.pharmacy_id = ? AND i.ativo = 1
      GROUP BY i.ean`, pid);

  return linhas.map((l) => {
    const porDia = l.vendidos / 14;
    const dias = porDia > 0 ? Math.floor(l.estoque / porDia) : null;
    return { ...l, por_dia: +porDia.toFixed(2), dias_para_zerar: dias };
  })
  .filter((l) => l.estoque <= 0 || (l.dias_para_zerar !== null && l.dias_para_zerar <= limiteDias))
  .sort((a, b) => (a.dias_para_zerar ?? -1) - (b.dias_para_zerar ?? -1));
}

/** Fechamento de repasse: bruto − comissão. */
export function fechaRepasse(pid, inicio, fim) {
  const pedidos = todos(
    `SELECT * FROM orders WHERE pharmacy_id=? AND status='entregue' AND entregue_em BETWEEN ? AND ?`,
    pid, inicio, fim);
  const bruto = pedidos.reduce((s, o) => s + o.total_centavos, 0);
  const comissao = pedidos.reduce((s, o) => s + o.comissao_centavos, 0);
  const frete = pedidos.reduce((s, o) => s + o.frete_centavos, 0);
  const pid2 = id();
  roda(`INSERT INTO payouts (id,pharmacy_id,periodo_inicio,periodo_fim,bruto_centavos,
          comissao_centavos,frete_centavos,liquido_centavos,status,criado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
    pid2, pid, inicio, fim, bruto, comissao, frete, bruto - comissao, 'fechado', agora());
  return um('SELECT * FROM payouts WHERE id = ?', pid2);
}

/**
 * A tela de abertura do painel.
 *
 * Um dono de farmácia não quer "relatórios": quer saber, em cinco
 * segundos, se hoje está indo bem e o que está pegando fogo. Isto aqui
 * é exatamente isso — números do dia, a série das duas semanas para dar
 * contexto, e a lista do que precisa de mão.
 */
export function visao(pid) {
  const serie = todos(
    `SELECT substr(entregue_em,1,10) AS dia, COUNT(*) AS pedidos,
            COALESCE(SUM(total_centavos),0) AS bruto_centavos
       FROM orders WHERE pharmacy_id=? AND status='entregue'
        AND entregue_em >= datetime('now','-13 days')
      GROUP BY dia ORDER BY dia`, pid);

  const dias = [...Array(14)].map((_, k) => {
    const d = new Date(Date.now() - (13 - k) * 864e5).toISOString().slice(0, 10);
    const achou = serie.find((s) => s.dia === d);
    return { dia: d, pedidos: achou?.pedidos ?? 0, bruto_centavos: achou?.bruto_centavos ?? 0 };
  });

  const janela = (n) => um(
    `SELECT COUNT(*) AS pedidos, COALESCE(SUM(total_centavos),0) AS bruto,
            COALESCE(SUM(total_centavos - comissao_centavos),0) AS liquido
       FROM orders WHERE pharmacy_id=? AND status='entregue'
        AND entregue_em >= datetime('now', ?)`, pid, `-${n} days`);

  const d7 = janela(7), d30 = janela(30), d60 = janela(60);
  const anterior7 = um(
    `SELECT COALESCE(SUM(total_centavos),0) AS bruto FROM orders
      WHERE pharmacy_id=? AND status='entregue'
        AND entregue_em >= datetime('now','-14 days')
        AND entregue_em <  datetime('now','-7 days')`, pid);

  return {
    hoje: indicadores(pid),
    serie: dias,
    semana: { ...d7, ticket_centavos: d7.pedidos ? Math.round(d7.bruto / d7.pedidos) : 0,
      variacao_pct: anterior7.bruto
        ? +(((d7.bruto - anterior7.bruto) / anterior7.bruto) * 100).toFixed(1) : null },
    mes: { ...d30, ticket_centavos: d30.pedidos ? Math.round(d30.bruto / d30.pedidos) : 0 },
    bimestre: d60,
    clientes: {
      total: um(`SELECT COUNT(DISTINCT user_id) AS n FROM orders WHERE pharmacy_id=?`, pid).n,
      novos_30d: um(
        `SELECT COUNT(*) AS n FROM (SELECT user_id, MIN(criado_em) AS p FROM orders
           WHERE pharmacy_id=? GROUP BY user_id) WHERE p >= datetime('now','-30 days')`, pid).n,
      socios: um(
        `SELECT COUNT(DISTINCT o.user_id) AS n FROM orders o JOIN users u ON u.id=o.user_id
          WHERE o.pharmacy_id=? AND u.socio=1`, pid).n,
    },
  };
}

/**
 * Editar a própria loja. Campos livres são os comerciais e de contato;
 * CNPJ e razão social não entram — quem muda isso é a Receita, não a tela.
 */
const EDITAVEIS = ['nome_fantasia', 'telefone', 'email', 'logradouro', 'numero', 'bairro',
  'cidade', 'uf', 'cep', 'raio_entrega_m', 'frete_centavos',
  'frete_gratis_acima_centavos', 'entregador_proprio'];

export function atualiza(pid, dados = {}) {
  const f = um('SELECT * FROM pharmacies WHERE id = ?', pid);
  if (!f) throw new Erro(404, 'LOJA_INEXISTENTE', 'Loja não encontrada');
  const campos = EDITAVEIS.filter((c) => dados[c] !== undefined);
  if (!campos.length) return f;
  if (dados.frete_centavos !== undefined && Number(dados.frete_centavos) < 0) {
    throw new Erro(422, 'FRETE_INVALIDO', 'Frete não pode ser negativo');
  }
  if (dados.nome_fantasia !== undefined && !String(dados.nome_fantasia).trim()) {
    throw new Erro(422, 'NOME_OBRIGATORIO', 'A loja precisa de um nome');
  }
  roda(`UPDATE pharmacies SET ${campos.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    ...campos.map((c) => dados[c]), pid);
  return um('SELECT * FROM pharmacies WHERE id = ?', pid);
}

/** Horário de funcionamento, um dia por linha. */
export function defineHorario(pid, dias = []) {
  return transacao(() => {
    for (const d of dias) {
      roda(`INSERT INTO pharmacy_hours (pharmacy_id,dia_semana,abre,fecha,is_24h,fechado)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(pharmacy_id,dia_semana) DO UPDATE SET
              abre=excluded.abre, fecha=excluded.fecha,
              is_24h=excluded.is_24h, fechado=excluded.fechado`,
        pid, d.dia_semana, d.abre ?? null, d.fecha ?? null,
        d.is_24h ? 1 : 0, d.fechado ? 1 : 0);
    }
    return todos('SELECT * FROM pharmacy_hours WHERE pharmacy_id=? ORDER BY dia_semana', pid);
  });
}

/**
 * ============================================================
 * CADASTRO DE PRODUTO PELA LOJA
 *
 * Até aqui o catálogo era uma lista fechada da plataforma e a loja só
 * mexia em preço e estoque. Farmácia de verdade vende o que quiser —
 * dermocosmético, fralda, garrafinha — e esperar alguém "cadastrar no
 * mestre" é o tipo de dependência que faz o dono desistir do sistema.
 *
 * O que continua travado, e é de propósito:
 *   · controlado da Portaria 344 não entra por tela nenhuma;
 *   · preço acima do PMC da CMED é recusado, como sempre foi;
 *   · EAN é a chave do produto: se já existe, atualiza em vez de
 *     duplicar — catálogo com o mesmo item duas vezes vira estoque
 *     errado na semana seguinte.
 * ============================================================
 */
const CATEGORIAS = ['dor', 'gripe', 'pressao', 'antibiotico', 'dermo', 'vitaminas',
  'bebe', 'higiene', 'refrigerado', 'controlado', 'outros'];

export function salvaProduto(pid, dados, autorId) {
  const {
    ean, nome, descricao, marca, principio_ativo, dosagem, apresentacao, fabricante,
    categoria = 'outros', tarja = 'livre', requer_receita = 0, retem_receita = 0,
    generico = 0, refrigerado = 0, registro_ms, pmc_centavos,
    preco_centavos, preco_de_centavos, estoque = 0, posicao, ativo = 1,
  } = dados;

  if (!nome?.trim()) throw new Erro(422, 'NOME_OBRIGATORIO', 'O produto precisa de um nome');
  if (!/^\d{8,14}$/.test(String(ean ?? ''))) {
    throw new Erro(422, 'EAN_INVALIDO',
      'O código de barras precisa ter de 8 a 14 dígitos. É ele que identifica o produto.');
  }
  if (!CATEGORIAS.includes(categoria)) {
    throw new Erro(422, 'CATEGORIA_INVALIDA', `Categoria desconhecida: ${categoria}`);
  }
  if (!['livre', 'vermelha', 'preta'].includes(tarja)) {
    throw new Erro(422, 'TARJA_INVALIDA', `Tarja desconhecida: ${tarja}`);
  }
  if (tarja === 'preta') {
    throw new Erro(422, 'CONTROLADO_FORA_DA_PLATAFORMA',
      'Medicamento de tarja preta é da Portaria 344 e não pode ser vendido por delivery');
  }
  const preco = Number(preco_centavos);
  if (!Number.isInteger(preco) || preco <= 0) {
    throw new Erro(422, 'PRECO_INVALIDO', 'O preço tem que ser maior que zero');
  }
  if (preco_de_centavos && Number(preco_de_centavos) <= preco) {
    throw new Erro(422, 'PROMOCAO_INVALIDA',
      'O preço "de" precisa ser maior que o preço de venda — senão não é promoção, é aumento');
  }
  if (pmc_centavos && preco > Number(pmc_centavos)) {
    throw new Erro(422, 'ACIMA_DO_PMC',
      `R$ ${(preco / 100).toFixed(2)} passa o preço máximo ao consumidor que você declarou`);
  }

  return transacao(() => {
    const ja = um('SELECT * FROM products WHERE ean = ?', ean);
    // a tarja manda na receita: vermelha sempre exige, e o formulário não
    // pode deixar as duas coisas se contradizerem
    const exigeReceita = tarja === 'vermelha' ? 1 : (requer_receita ? 1 : 0);

    roda(`INSERT INTO products (ean,nome,descricao,marca,principio_ativo,dosagem,apresentacao,
            fabricante,categoria,tarja,requer_receita,retem_receita,controlado_344,refrigerado,
            generico,registro_ms,pmc_centavos,ativo,criado_por,criado_em)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)
          ON CONFLICT(ean) DO UPDATE SET
            nome=excluded.nome, descricao=excluded.descricao, marca=excluded.marca,
            principio_ativo=excluded.principio_ativo, dosagem=excluded.dosagem,
            apresentacao=excluded.apresentacao, fabricante=excluded.fabricante,
            categoria=excluded.categoria, tarja=excluded.tarja,
            requer_receita=excluded.requer_receita, retem_receita=excluded.retem_receita,
            refrigerado=excluded.refrigerado, generico=excluded.generico,
            registro_ms=excluded.registro_ms, pmc_centavos=excluded.pmc_centavos,
            ativo=excluded.ativo`,
      ean, nome.trim(), descricao?.trim() || null, marca?.trim() || null,
      principio_ativo?.trim() || null, dosagem?.trim() || null, apresentacao?.trim() || null,
      fabricante?.trim() || null, categoria, tarja, exigeReceita, retem_receita ? 1 : 0,
      refrigerado ? 1 : 0, generico ? 1 : 0, registro_ms?.trim() || null,
      pmc_centavos ? Number(pmc_centavos) : null, ativo ? 1 : 0,
      ja ? (ja.criado_por ?? autorId ?? null) : (autorId ?? null),
      ja ? (ja.criado_em ?? agora()) : agora());

    // preço e estoque continuam sendo da loja, não do produto
    defineItem(pid, {
      ean, preco_centavos: preco,
      preco_socio_centavos: null,
      estoque: Number(estoque) || 0,
      ativo, posicao,
    });
    if (preco_de_centavos !== undefined) {
      roda('UPDATE inventory SET preco_de_centavos = ? WHERE pharmacy_id = ? AND ean = ?',
        preco_de_centavos ? Number(preco_de_centavos) : null, pid, ean);
    }

    return um(`SELECT p.*, i.preco_centavos, i.preco_de_centavos, i.estoque, i.posicao,
                      i.ativo AS ativo_na_loja
                 FROM products p JOIN inventory i ON i.ean = p.ean
                WHERE p.ean = ? AND i.pharmacy_id = ?`, ean, pid);
  });
}

/** Tira o produto da vitrine sem apagar nada: histórico de venda continua de pé. */
export function arquivaProduto(pid, ean, ativo) {
  const i = um('SELECT * FROM inventory WHERE pharmacy_id=? AND ean=?', pid, ean);
  if (!i) throw new Erro(404, 'FORA_DO_CATALOGO', 'Esse produto não está no seu catálogo');
  roda('UPDATE inventory SET ativo = ?, atualizado_em = ? WHERE pharmacy_id=? AND ean=?',
    ativo ? 1 : 0, agora(), pid, ean);
  return um('SELECT * FROM inventory WHERE pharmacy_id=? AND ean=?', pid, ean);
}
