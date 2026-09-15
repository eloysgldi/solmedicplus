import { um, todos, roda, id, agora } from './db.js';
import { publica } from './events.js';
import * as push from './push.js';

/**
 * ============================================================
 * O que a gente avisa, para quem, e com quanta intimidade.
 *
 * A regra que governa tudo aqui: notificação de farmácia aparece na
 * tela bloqueada. "Sua Losartana saiu para entrega" conta a doença do
 * seu cliente para quem passar perto do celular dele. Então o texto
 * curto é sempre genérico, e o nome do remédio só vai para quem pediu
 * (users.push_detalhado) — ou fica dentro do app, depois do desbloqueio.
 *
 * O texto para a LOJA é o contrário: quanto mais detalhe, melhor.
 * ============================================================
 */

const brl = (c) => 'R$ ' + ((c ?? 0) / 100).toFixed(2).replace('.', ',');

/** Os avisos do cliente, cada um com a versão discreta e a detalhada. */
export const AVISOS = {
  aceito: (o) => ({
    titulo: `Pedido ${o.codigo} confirmado`,
    corpo: 'A farmácia já está separando.',
    detalhe: (itens) => `Separando ${itens}.`,
  }),
  receita_liberada: (o) => ({
    titulo: `Pedido ${o.codigo} liberado`,
    corpo: 'O farmacêutico conferiu e liberou.',
    detalhe: () => 'O farmacêutico conferiu a receita e liberou.',
  }),
  conferindo: (o) => ({
    titulo: `Pedido ${o.codigo}`,
    corpo: 'Conferindo lote e validade de cada caixa.',
    detalhe: (itens) => `Conferindo lote e validade: ${itens}.`,
  }),
  saiu: (o, extra) => ({
    titulo: `Pedido ${o.codigo} saiu para entrega`,
    corpo: `${extra?.entregador ?? 'O entregador'} está a caminho · chega ${extra?.eta ?? 'em breve'}.`,
    detalhe: (itens) => `${extra?.entregador ?? 'O entregador'} saiu com ${itens}.`,
  }),
  perto: (o, extra) => ({
    titulo: `${extra?.entregador ?? 'Entregador'} está chegando`,
    corpo: 'Menos de 2 minutos. Fique perto da porta.',
    detalhe: () => 'Menos de 2 minutos. Fique perto da porta.',
  }),
  entregue: (o) => ({
    titulo: `Pedido ${o.codigo} entregue`,
    corpo: 'Como foi? Sua nota ajuda a gente a melhorar.',
    detalhe: () => 'Como foi? Sua nota ajuda a gente a melhorar.',
  }),
  contraproposta: (o, extra) => ({
    titulo: `Faltou um item do ${o.codigo}`,
    corpo: 'A farmácia ofereceu outro no lugar. Toque para decidir.',
    detalhe: () => `A farmácia ofereceu ${extra?.oferecido ?? 'um substituto'} no lugar.`,
    insistente: true,
  }),
  cancelado: (o, extra) => ({
    titulo: `Pedido ${o.codigo} cancelado`,
    corpo: `${extra?.motivo ?? 'O valor volta para o seu cartão.'}`,
    detalhe: () => extra?.motivo ?? 'O valor volta para o seu cartão.',
  }),
  recall: (o, extra) => ({
    titulo: 'Recolhimento de lote — pare de usar',
    corpo: `Um produto que você recebeu foi recolhido. Toque para ver o que fazer.`,
    detalhe: () => `${extra?.produto ?? 'Um produto'}${extra?.lote ? `, lote ${extra.lote}` : ''}, `
      + `foi recolhido: ${extra?.motivo ?? ''}`,
    insistente: true,
  }),
  vencendo: (o, extra) => ({
    titulo: 'Tem remédio vencendo no seu armário',
    corpo: `Um item vence em ${extra?.dias ?? 'poucos'} dias. Toque para ver.`,
    detalhe: () => `${extra?.produto ?? 'Um item'} vence em ${extra?.validade ?? 'breve'}.`,
  }),
  teste: () => ({
    titulo: 'Funcionando',
    corpo: 'É assim que a gente vai te avisar quando seu pedido andar.',
    detalhe: () => 'É assim que a gente vai te avisar quando seu pedido andar.',
  }),
  resposta_farmaceutico: (o, extra) => ({
    titulo: `${extra?.quem ?? 'O farmacêutico'} respondeu`,
    corpo: 'Toque para ler a orientação.',
    detalhe: () => 'Toque para ler a orientação.',
  }),
  recompra: (o, extra) => ({
    titulo: 'Sua recompra está chegando',
    corpo: 'Um item que você usa sempre está acabando. Toque para repetir.',
    detalhe: (itens) => `${itens ?? 'Um item que você usa sempre'} está acabando. Toque para repetir o pedido.`,
  }),
};

/**
 * Manda para um cliente. Escolhe o texto pela preferência dele,
 * guarda no histórico e tenta todos os aparelhos inscritos.
 */
export async function paraCliente(userId, tipo, pedido, extra = {}) {
  const molde = AVISOS[tipo]?.(pedido ?? {}, extra);
  if (!molde) return null;

  const u = um('SELECT push_detalhado FROM users WHERE id = ?', userId);
  // quem pediu detalhe recebe o nome do medicamento; o padrão é genérico,
  // porque a notificação acende na tela de bloqueio na frente de qualquer um
  const corpo = u?.push_detalhado ? molde.detalhe(extra.itens) : molde.corpo;

  const nid = id();
  const url = ['recall', 'vencendo'].includes(tipo) ? '/#armario'
    : tipo === 'resposta_farmaceutico' ? '/#conversa'
    : pedido?.id ? `/#pedido/${pedido.id}` : '/#inicio';
  roda(`INSERT INTO notificacoes (id,user_id,tipo,titulo,corpo,url,order_id,criado_em)
        VALUES (?,?,?,?,?,?,?,?)`,
    nid, userId, tipo, molde.titulo, corpo, url, pedido?.id ?? null, agora());

  // dentro do app, chega na hora pelo canal que já existe
  publica(`user:${userId}`, { tipo: 'notificacao', notificacao: { id: nid, titulo: molde.titulo, corpo, url } });
  await empurra(userId, { titulo: molde.titulo, corpo, url, tag: tipo, insistente: !!molde.insistente });
  return nid;
}


/**
 * Aviso escrito à mão pela loja (campanha, recado).
 *
 * Não passa pelos moldes porque não tem molde: o texto é da loja. Mas
 * passa pelo mesmo caminho — histórico, canal interno e push — para não
 * existir uma segunda forma de falar com o cliente sem registro.
 */
export async function avulso(userId, { titulo, corpo, url = '/#inicio', tipo = 'loja' }) {
  const nid = id();
  roda(`INSERT INTO notificacoes (id,user_id,tipo,titulo,corpo,url,order_id,criado_em)
        VALUES (?,?,?,?,?,?,NULL,?)`, nid, userId, tipo, titulo, corpo, url, agora());
  publica(`user:${userId}`, { tipo: 'notificacao', notificacao: { id: nid, titulo, corpo, url } });
  await empurra(userId, { titulo, corpo, url, tag: tipo });
  return nid;
}

/** Para a loja o texto é cru: o que, quanto, onde, e quanto tempo resta. */
export async function paraLoja(pharmacyId, tipo, dados = {}) {
  const moldes = {
    pedido_novo: {
      titulo: `Novo pedido · ${dados.bairro ?? ''}`.trim(),
      corpo: `${dados.itens ?? 0} ${dados.itens === 1 ? 'item' : 'itens'} · ${brl(dados.total)} · ${dados.segundos ?? 90}s para aceitar`,
      insistente: true,
    },
    receita_na_fila: {
      titulo: 'Receita esperando conferência',
      corpo: `${dados.principio ?? 'Um item'} · pedido ${dados.codigo ?? ''}`,
    },
    retencao_pendente: {
      titulo: 'Via de receita a arquivar',
      corpo: `${dados.quantas ?? 1} receita(s) de papel voltaram e precisam de registro`,
    },
    estoque_acabando: {
      titulo: 'Estoque acabando',
      corpo: `${dados.produto ?? ''} deve zerar em ${dados.dias ?? 2} dias no ritmo atual`,
    },
    avaliacao_ruim: {
      titulo: `Nota ${dados.nota ?? ''} no pedido ${dados.codigo ?? ''}`,
      corpo: dados.motivo ?? 'O cliente apontou um problema.',
      insistente: true,
    },
  };
  const molde = moldes[tipo];
  if (!molde) return;

  publica(`loja:${pharmacyId}`, { tipo: 'aviso', aviso: { ...molde, chave: tipo } });
  const equipe = todos(
    `SELECT user_id FROM pharmacy_users WHERE pharmacy_id = ? AND ativo = 1`, pharmacyId);
  for (const m of equipe) {
    await empurra(m.user_id, { ...molde, url: '/painel.html', tag: tipo });
  }
}

/** Dispara para todos os aparelhos do usuário e limpa os que morreram. */
async function empurra(userId, payload) {
  const inscricoes = todos('SELECT * FROM push_inscricoes WHERE user_id = ?', userId);
  await Promise.all(inscricoes.map(async (i) => {
    try {
      const r = await push.envia(i, payload);
      if (r.morta) roda('DELETE FROM push_inscricoes WHERE id = ?', i.id);
      else roda('UPDATE push_inscricoes SET usado_em = ? WHERE id = ?', agora(), i.id);
    } catch {
      // serviço de push fora do ar não pode derrubar o pedido
    }
  }));
}

export const doCliente = (userId, limite = 30) =>
  todos(`SELECT * FROM notificacoes WHERE user_id = ? ORDER BY criado_em DESC LIMIT ?`, userId, limite);

export const naoLidas = (userId) =>
  um('SELECT COUNT(*) AS n FROM notificacoes WHERE user_id = ? AND lida_em IS NULL', userId).n;

export const marcaLidas = (userId) =>
  roda('UPDATE notificacoes SET lida_em = ? WHERE user_id = ? AND lida_em IS NULL', agora(), userId);
