import { um, todos, roda, id, agora } from './db.js';
import { Erro } from './http.js';
import * as armario from './armario.js';
import * as avisa from './notificacoes.js';

/**
 * ============================================================
 * CRM
 *
 * A ficha do cliente não é uma tabela nova: é uma leitura dos pedidos,
 * do armário e das receitas que já existem. Cadastro paralelo envelhece
 * e mente; pedido entregue não mente.
 *
 * O que precisa de tabela é só o que a equipe escreve à mão — a nota
 * ("não gosta de campainha, ligar") e a marca ("acamado", "uso contínuo").
 *
 * A segmentação é RFM, sem enfeite: quando comprou, quantas vezes, quanto
 * gastou. O corte que importa para farmácia é o *intervalo próprio* de
 * cada cliente — quem compra losartana todo mês e sumiu há 45 dias é um
 * problema clínico antes de ser um problema comercial.
 * ============================================================
 */

const dias = (iso) => iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : null;

/** Uma linha por cliente que já comprou nesta loja. */
function base(pid) {
  return todos(
    `SELECT u.id, u.nome, u.email, u.telefone, u.socio, u.criado_em, u.push_detalhado,
            COUNT(o.id) AS pedidos,
            SUM(o.total_centavos) AS gasto_centavos,
            MIN(o.criado_em) AS primeira_em,
            MAX(o.criado_em) AS ultima_em,
            SUM(CASE WHEN o.status='cancelado' THEN 1 ELSE 0 END) AS cancelados
       FROM users u JOIN orders o ON o.user_id = u.id
      WHERE o.pharmacy_id = ? AND o.status <> 'criado'
      GROUP BY u.id`, pid);
}

/** Classifica sem inventar: tudo sai de data, contagem e valor. */
function classifica(c) {
  const desdeUltima = dias(c.ultima_em);
  const janela = c.pedidos > 1
    ? Math.round((Date.parse(c.ultima_em) - Date.parse(c.primeira_em)) / 864e5 / (c.pedidos - 1))
    : null;

  const segmento =
    desdeUltima > 120 ? 'perdido'
    : c.pedidos >= 2 && janela && desdeUltima > janela * 1.8 ? 'em_risco'
    : desdeUltima > 90 ? 'em_risco'
    : c.pedidos >= 4 && desdeUltima <= 30 ? 'fiel'
    : c.pedidos === 1 && dias(c.primeira_em) <= 30 ? 'novo'
    : 'regular';

  return {
    ...c,
    gasto_centavos: c.gasto_centavos ?? 0,
    ticket_centavos: c.pedidos ? Math.round((c.gasto_centavos ?? 0) / c.pedidos) : 0,
    dias_sem_comprar: desdeUltima,
    intervalo_medio_dias: janela,
    segmento,
    // o cliente já passou do próprio ritmo: é hora de lembrar, não de esperar
    recompra_atrasada: !!(janela && desdeUltima > janela && desdeUltima <= 120),
  };
}

const SEGMENTOS = ['novo', 'regular', 'fiel', 'em_risco', 'perdido'];

export function lista(pid, { q = '', segmento = '', ordem = 'recentes' } = {}) {
  const busca = q.trim().toLowerCase();
  let itens = base(pid).map(classifica);
  if (busca) {
    itens = itens.filter((c) => `${c.nome} ${c.email} ${c.telefone ?? ''}`.toLowerCase().includes(busca));
  }
  if (segmento) itens = itens.filter((c) => c.segmento === segmento);

  const marcas = todos('SELECT user_id, marca FROM cliente_marcas WHERE pharmacy_id = ?', pid);
  const notas = todos(
    `SELECT user_id, COUNT(*) AS n FROM cliente_notas WHERE pharmacy_id=? GROUP BY user_id`, pid);
  itens = itens.map((c) => ({
    ...c,
    marcas: marcas.filter((m) => m.user_id === c.id).map((m) => m.marca),
    notas: notas.find((n) => n.user_id === c.id)?.n ?? 0,
  }));

  const ordens = {
    recentes: (a, b) => (a.dias_sem_comprar ?? 1e9) - (b.dias_sem_comprar ?? 1e9),
    valor: (a, b) => b.gasto_centavos - a.gasto_centavos,
    frequencia: (a, b) => b.pedidos - a.pedidos,
    sumidos: (a, b) => (b.dias_sem_comprar ?? 0) - (a.dias_sem_comprar ?? 0),
    nome: (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'),
  };
  return itens.sort(ordens[ordem] ?? ordens.recentes);
}

/** Quanto vale cada balde. Serve para decidir onde gastar atenção. */
export function segmentos(pid) {
  const itens = base(pid).map(classifica);
  return SEGMENTOS.map((s) => {
    const dele = itens.filter((c) => c.segmento === s);
    return {
      segmento: s, clientes: dele.length,
      valor_centavos: dele.reduce((t, c) => t + c.gasto_centavos, 0),
      ticket_centavos: dele.length
        ? Math.round(dele.reduce((t, c) => t + c.ticket_centavos, 0) / dele.length) : 0,
    };
  });
}

/**
 * A ficha. Tudo o que a loja sabe sobre uma pessoa, numa tela só —
 * inclusive o que ela tem em casa, que é o que nenhum CRM de varejo tem.
 */
export function ficha(pid, userId) {
  const u = um('SELECT * FROM users WHERE id = ?', userId);
  if (!u) throw new Erro(404, 'CLIENTE_INEXISTENTE', 'Esse cliente não existe');
  const linha = base(pid).find((c) => c.id === userId);
  if (!linha) throw new Erro(404, 'SEM_HISTORICO', 'Esse cliente nunca comprou aqui');
  const c = classifica(linha);

  const pedidos = todos(
    `SELECT o.*, (SELECT COUNT(*) FROM order_items WHERE order_id=o.id) AS itens
       FROM orders o WHERE o.pharmacy_id=? AND o.user_id=?
      ORDER BY o.criado_em DESC LIMIT 25`, pid, userId);

  const favoritos = todos(
    `SELECT oi.ean, p.nome, p.apresentacao, SUM(oi.qtd) AS unidades,
            COUNT(DISTINCT o.id) AS vezes, MAX(o.criado_em) AS ultima_em
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.ean = oi.ean
      WHERE o.pharmacy_id=? AND o.user_id=? AND o.status='entregue'
      GROUP BY oi.ean ORDER BY vezes DESC, unidades DESC LIMIT 8`, pid, userId);

  const avaliacoes = todos(
    `SELECT a.*, o.codigo FROM avaliacoes a JOIN orders o ON o.id = a.order_id
      WHERE o.pharmacy_id=? AND o.user_id=? ORDER BY a.criado_em DESC LIMIT 5`, pid, userId);

  return {
    cliente: c,
    enderecos: todos('SELECT * FROM addresses WHERE user_id = ? ORDER BY padrao DESC', userId),
    pedidos,
    favoritos,
    // o que está na casa dele agora: o diferencial, do lado da loja
    armario: armario.doCliente(userId),
    receitas: todos(
      `SELECT DISTINCT r.* FROM prescriptions r
         JOIN prescription_items pi ON pi.prescription_id = r.id
         JOIN order_items oi ON oi.prescription_item_id = pi.id
         JOIN orders o ON o.id = oi.order_id
        WHERE o.pharmacy_id=? AND r.user_id=? ORDER BY r.criado_em DESC LIMIT 10`, pid, userId),
    conversas: todos(
      `SELECT * FROM conversas WHERE user_id=? ORDER BY criado_em DESC LIMIT 10`, userId),
    avaliacoes,
    nota_media: avaliacoes.length
      ? +(avaliacoes.reduce((s, a) => s + a.nota, 0) / avaliacoes.length).toFixed(1) : null,
    notas: todos(
      `SELECT n.*, u.nome AS autor FROM cliente_notas n LEFT JOIN users u ON u.id = n.autor_id
        WHERE n.pharmacy_id=? AND n.user_id=? ORDER BY n.fixada DESC, n.criado_em DESC`, pid, userId),
    marcas: todos(
      'SELECT marca FROM cliente_marcas WHERE pharmacy_id=? AND user_id=?', pid, userId)
      .map((m) => m.marca),
  };
}

/** O recado que a equipe deixa para a equipe. */
export function anota(pid, userId, { texto, fixada = 0 }, autorId) {
  if (!texto?.trim()) throw new Erro(422, 'TEXTO_OBRIGATORIO', 'Escreva a nota');
  const nid = id();
  roda(`INSERT INTO cliente_notas (id,pharmacy_id,user_id,texto,autor_id,fixada,criado_em)
        VALUES (?,?,?,?,?,?,?)`, nid, pid, userId, texto.trim(), autorId ?? null,
    fixada ? 1 : 0, agora());
  return um('SELECT * FROM cliente_notas WHERE id = ?', nid);
}

export function apagaNota(pid, notaId) {
  const n = um('SELECT * FROM cliente_notas WHERE id=? AND pharmacy_id=?', notaId, pid);
  if (!n) throw new Erro(404, 'NOTA_INEXISTENTE', 'Essa nota não existe');
  roda('DELETE FROM cliente_notas WHERE id = ?', notaId);
  return { ok: true };
}

/** Marcas são operacionais: "acamado", "prédio sem elevador", "uso contínuo". */
export function marca(pid, userId, marca, ligar = true) {
  const m = String(marca ?? '').trim().toLowerCase().slice(0, 24);
  if (!m) throw new Erro(422, 'MARCA_INVALIDA', 'Marca vazia');
  if (ligar) {
    roda(`INSERT OR IGNORE INTO cliente_marcas (pharmacy_id,user_id,marca,criado_em)
          VALUES (?,?,?,?)`, pid, userId, m, agora());
  } else {
    roda('DELETE FROM cliente_marcas WHERE pharmacy_id=? AND user_id=? AND marca=?', pid, userId, m);
  }
  return todos('SELECT marca FROM cliente_marcas WHERE pharmacy_id=? AND user_id=?', pid, userId)
    .map((x) => x.marca);
}

/** A nota fixada aparece no card do pedido, na hora da separação. */
export const notasFixadas = (pid, userId) => todos(
  `SELECT texto FROM cliente_notas WHERE pharmacy_id=? AND user_id=? AND fixada=1
    ORDER BY criado_em DESC`, pid, userId).map((n) => n.texto);

/**
 * Quem deveria ter voltado e não voltou.
 *
 * Não é "quem sumiu há 30 dias": é quem passou do *próprio* intervalo.
 * Para uso contínuo isso costuma significar que a pessoa parou o
 * tratamento — e aí ligar vale mais do que qualquer cupom.
 */
export function recompras(pid, { limite = 40 } = {}) {
  return base(pid).map(classifica)
    .filter((c) => c.recompra_atrasada && c.pedidos >= 2)
    .map((c) => {
      const item = um(
        `SELECT p.nome, p.ean, MAX(o.criado_em) AS quando
           FROM order_items oi JOIN orders o ON o.id = oi.order_id
           JOIN products p ON p.ean = oi.ean
          WHERE o.pharmacy_id=? AND o.user_id=? AND o.status='entregue'
          GROUP BY oi.ean ORDER BY COUNT(*) DESC LIMIT 1`, pid, c.id);
      return { ...c, item_provavel: item?.nome ?? null, ean_provavel: item?.ean ?? null,
        atraso_dias: c.dias_sem_comprar - (c.intervalo_medio_dias ?? 0) };
    })
    .sort((a, b) => b.atraso_dias - a.atraso_dias)
    .slice(0, limite);
}

/**
 * Campanha por segmento.
 *
 * Isso aqui é uma arma apontada para a base inteira, então tem trava:
 * texto obrigatório, um registro permanente de quem disparou, e nada de
 * nome de medicamento no corpo — a notificação acende na tela de bloqueio
 * na frente de qualquer um, e remédio é dado de saúde.
 */
export async function campanha(pid, { segmento, titulo, corpo, url }, autorId) {
  if (!SEGMENTOS.includes(segmento) && segmento !== 'todos') {
    throw new Erro(422, 'SEGMENTO_INVALIDO', `Segmento desconhecido: ${segmento}`);
  }
  if (!titulo?.trim() || !corpo?.trim()) {
    throw new Erro(422, 'TEXTO_OBRIGATORIO', 'Campanha sem título e corpo não sai');
  }
  const alvos = lista(pid, { segmento: segmento === 'todos' ? '' : segmento });
  const cid = id();
  roda(`INSERT INTO campanhas (id,pharmacy_id,segmento,titulo,corpo,url,alcance,criado_por,criado_em)
        VALUES (?,?,?,?,?,?,?,?,?)`, cid, pid, segmento, titulo.trim(), corpo.trim(),
    url ?? null, alvos.length, autorId ?? null, agora());

  for (const c of alvos) {
    avisa.avulso(c.id, { titulo: titulo.trim(), corpo: corpo.trim(), url: url || '/#inicio' })
      .catch(() => {});
  }
  return { ...um('SELECT * FROM campanhas WHERE id = ?', cid),
    enviados: alvos.map((c) => c.nome) };
}

export const historicoCampanhas = (pid) => todos(
  `SELECT c.*, u.nome AS autor FROM campanhas c LEFT JOIN users u ON u.id = c.criado_por
    WHERE c.pharmacy_id = ? ORDER BY c.criado_em DESC LIMIT 20`, pid);
