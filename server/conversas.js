import { um, todos, roda, id, agora } from './db.js';
import { Erro } from './http.js';
import { publica } from './events.js';
import { lojaDaCasa } from './config.js';
import * as avisa from './notificacoes.js';

/**
 * ============================================================
 * Orientação farmacêutica por mensagem.
 *
 * Isto é atividade privativa do farmacêutico, e por isso toda resposta
 * sai assinada com nome e CRF — do mesmo jeito que a liberação de receita.
 * O aviso de rodapé não é enfeite jurídico: orientação não é consulta,
 * e a hora de dizer isso é antes, não depois.
 * ============================================================ */
export const RESSALVA =
  'Orientação farmacêutica não substitui consulta médica. '
  + 'Em caso de urgência, procure atendimento.';

/** Perguntas que já vêm prontas — tira o medo da folha em branco. */
export const ATALHOS = [
  'Posso tomar esses dois juntos?',
  'Qual a dose para criança?',
  'Tem versão sem açúcar?',
  'Isso serve para o meu caso?',
  'Posso tomar em jejum?',
];

/** A conversa aberta do cliente, ou uma nova. Uma por vez, e basta. */
export function minha(user, { assunto = null, orderId = null } = {}) {
  let c = um(`SELECT * FROM conversas WHERE user_id = ? AND status != 'fechada'
               ORDER BY mexido_em DESC LIMIT 1`, user.id);
  if (!c) {
    const loja = lojaDaCasa();
    if (!loja) throw new Erro(503, 'SEM_FARMACIA', 'Nenhuma farmácia ativa agora');
    const cid = id();
    roda(`INSERT INTO conversas (id,user_id,pharmacy_id,assunto,status,order_id,criado_em,mexido_em)
          VALUES (?,?,?,?,?,?,?,?)`,
      cid, user.id, loja.id, assunto, 'aberta', orderId, agora(), agora());
    roda(`INSERT INTO mensagens (id,conversa_id,autor_tipo,autor_nome,texto,criado_em)
          VALUES (?,?,?,?,?,?)`,
      id(), cid, 'sistema', 'Solmedic+',
      'Um farmacêutico responde aqui. ' + RESSALVA, agora());
    c = um('SELECT * FROM conversas WHERE id = ?', cid);
  }
  return comMensagens(c.id);
}

export function comMensagens(cid) {
  const c = um('SELECT * FROM conversas WHERE id = ?', cid);
  if (!c) throw new Erro(404, 'CONVERSA_INEXISTENTE', 'Conversa não encontrada');
  return {
    ...c,
    cliente: um('SELECT id, nome FROM users WHERE id = ?', c.user_id),
    mensagens: todos('SELECT * FROM mensagens WHERE conversa_id = ? ORDER BY criado_em', cid),
  };
}

export function escreve(cid, texto, autor) {
  const t = String(texto ?? '').trim();
  if (!t) throw new Erro(400, 'MENSAGEM_VAZIA', 'Escreva alguma coisa');
  if (t.length > 1200) throw new Erro(400, 'MENSAGEM_LONGA', 'Mensagem muito longa');
  const c = um('SELECT * FROM conversas WHERE id = ?', cid);
  if (!c) throw new Erro(404, 'CONVERSA_INEXISTENTE', 'Conversa não encontrada');
  if (c.status === 'fechada') throw new Erro(409, 'CONVERSA_FECHADA', 'Essa conversa foi encerrada');

  const mid = id();
  roda(`INSERT INTO mensagens (id,conversa_id,autor_tipo,autor_id,autor_nome,crf,texto,criado_em)
        VALUES (?,?,?,?,?,?,?,?)`,
    mid, cid, autor.tipo, autor.id ?? null, autor.nome ?? null, autor.crf ?? null, t, agora());
  roda(`UPDATE conversas SET mexido_em = ?, status = ? WHERE id = ?`,
    agora(), autor.tipo === 'cliente' ? 'aberta' : 'respondida', cid);

  const msg = um('SELECT * FROM mensagens WHERE id = ?', mid);
  publica(`conversa:${cid}`, { tipo: 'mensagem', mensagem: msg });
  publica(`loja:${c.pharmacy_id}`, { tipo: 'conversa', conversa_id: cid });

  if (autor.tipo === 'farmaceutico') {
    avisa.paraCliente(c.user_id, 'resposta_farmaceutico', null, {
      quem: autor.nome, crf: autor.crf,
    }).catch(() => {});
  }
  return comMensagens(cid);
}

/** Fila da loja: quem está esperando resposta primeiro. */
export function fila(pharmacyId) {
  return todos(
    `SELECT id FROM conversas WHERE pharmacy_id = ? AND status = 'aberta'
      ORDER BY mexido_em`, pharmacyId).map((c) => comMensagens(c.id));
}

export function historico(pharmacyId, limite = 30) {
  return todos(
    `SELECT id FROM conversas WHERE pharmacy_id = ? ORDER BY mexido_em DESC LIMIT ?`,
    pharmacyId, limite).map((c) => comMensagens(c.id));
}

export function fecha(cid) {
  roda(`UPDATE conversas SET status = 'fechada', mexido_em = ? WHERE id = ?`, agora(), cid);
  publica(`conversa:${cid}`, { tipo: 'fechada' });
  return comMensagens(cid);
}

export const naoLidasDoCliente = (userId) => um(
  `SELECT COUNT(*) AS n FROM mensagens m JOIN conversas c ON c.id = m.conversa_id
    WHERE c.user_id = ? AND m.autor_tipo = 'farmaceutico' AND m.lida_em IS NULL`, userId).n;

export const marcaLidas = (cid, quem) => roda(
  `UPDATE mensagens SET lida_em = ? WHERE conversa_id = ? AND autor_tipo != ? AND lida_em IS NULL`,
  agora(), cid, quem);
