import { um, todos, roda, id, agora } from './db.js';
import { rotas, corpo, json, Erro } from './http.js';
import { abreSSE } from './events.js';
import { hashSenha, confereSenha, criaSessao, quemE, exigeLogin, exigeAdmin,
         exigeLoja, exigeFarmaceutico, registraAcesso } from './auth.js';
import * as pedidos from './pedidos.js';
import * as receitas from './receitas.js';
import * as comercio from './comercio.js';
import { linhaDoTempo } from './state.js';
import * as inicio from './inicio.js';
import * as avaliacoes from './avaliacoes.js';
import * as avisa from './notificacoes.js';
import * as conversas from './conversas.js';
import * as pix from './pix.js';
import * as psp from './psp.js';
import * as armario from './armario.js';
import * as estoque from './estoque.js';
import * as crm from './crm.js';
import * as fotos from './fotos.js';
import * as entregas from './entregas.js';
import { SINTOMAS, RESSALVA_SINTOMA, acha as achaSintoma } from './sintomas.js';
import { chavesVapid } from './push.js';
import { CONFIG, lojaDaCasa, filtroReceita, defineConfig, todasConfigs } from './config.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const r = rotas();
const ip = (req) => req.socket.remoteAddress;

// ============ acesso ============
r.post('/api/auth/registrar', async (req, res) => {
  const b = await corpo(req);
  if (!b.email || !b.senha || !b.nome) throw new Erro(400, 'DADOS_INCOMPLETOS', 'Nome, e-mail e senha são obrigatórios');
  if (um('SELECT id FROM users WHERE email = ?', b.email)) {
    throw new Erro(409, 'EMAIL_EM_USO', 'Já existe conta com esse e-mail');
  }
  const uid = id();
  roda(`INSERT INTO users (id,nome,email,telefone,senha_hash,papel_global,socio,criado_em)
        VALUES (?,?,?,?,?,?,?,?)`,
    uid, b.nome, b.email, b.telefone ?? null, hashSenha(b.senha), 'cliente', b.socio ? 1 : 0, agora());
  json(res, 201, { token: criaSessao(uid), user: um('SELECT id,nome,email,socio FROM users WHERE id=?', uid) });
});

r.post('/api/auth/login', async (req, res) => {
  const b = await corpo(req);
  const u = um('SELECT * FROM users WHERE email = ?', b.email ?? '');
  if (!u || !confereSenha(b.senha ?? '', u.senha_hash)) {
    throw new Erro(401, 'CREDENCIAIS_INVALIDAS', 'E-mail ou senha não conferem');
  }
  json(res, 200, { token: criaSessao(u.id), user: { id: u.id, nome: u.nome, email: u.email, socio: u.socio } });
});

r.get('/api/auth/eu', (req, res) => json(res, 200, quemE(req) ?? { anonimo: true }));

// ============ catálogo (cliente) ============
r.get('/api/catalogo/busca', (req, res, p, url) => {
  const q = (url.searchParams.get('q') || '').trim();
  const bairro = url.searchParams.get('bairro');
  const cat = url.searchParams.get('cat');
  const sintoma = achaSintoma(url.searchParams.get('sintoma'));
  if (!q && !cat && !sintoma) throw new Erro(400, 'BUSCA_VAZIA', 'Digite o que você procura');
  // busca por nome comercial E princípio ativo: quem digita a marca vê o genérico
  const achados = todos(
    `SELECT p.*, MIN(i.preco_centavos) AS menor_preco_centavos,
            MIN(i.preco_socio_centavos) AS menor_socio_centavos,
            MAX(i.preco_de_centavos) AS preco_de_centavos,
            COUNT(DISTINCT i.pharmacy_id) AS lojas
       FROM products p
       JOIN inventory i ON i.ean = p.ean AND i.ativo = 1 AND i.estoque > 0
       JOIN pharmacies f ON f.id = i.pharmacy_id AND f.status = 'ativa'
      WHERE p.ativo = 1 AND p.controlado_344 = 0 ${filtroReceita()}
        AND (? = '' OR p.nome LIKE ? OR p.principio_ativo LIKE ? OR p.ean = ?)
        AND (? IS NULL OR p.categoria = ?)
        AND (? IS NULL OR p.categoria IN (SELECT value FROM json_each(?))
             OR EXISTS (SELECT 1 FROM json_each(?) j
                        WHERE p.principio_ativo LIKE '%' || j.value || '%'))
        AND (? IS NULL OR f.bairro = ?)
      GROUP BY p.ean
      ORDER BY p.generico DESC, menor_preco_centavos ASC
      LIMIT 40`, q, `%${q}%`, `%${q}%`, q, cat, cat,
        sintoma ? '1' : null, JSON.stringify(sintoma?.categorias ?? []),
        JSON.stringify(sintoma?.principios ?? []),
        bairro, bairro);

  // para cada item de marca, aponta o genérico equivalente e a economia
  for (const a of achados) {
    if (!a.generico) {
      a.generico_equivalente = um(
        `SELECT p.ean, p.nome, MIN(i.preco_centavos) AS preco_centavos
           FROM products p JOIN inventory i ON i.ean=p.ean AND i.ativo=1 AND i.estoque>0
          WHERE p.generico=1 AND p.principio_ativo=? AND p.dosagem=? ${filtroReceita()}
          GROUP BY p.ean ORDER BY preco_centavos LIMIT 1`, a.principio_ativo, a.dosagem);
      if (a.generico_equivalente) {
        a.economia_centavos = a.menor_preco_centavos - a.generico_equivalente.preco_centavos;
      }
    }
  }
  json(res, 200, {
    q: sintoma ? sintoma.rotulo : q, categoria: cat,
    sintoma: sintoma ? { ...sintoma, ressalva: RESSALVA_SINTOMA } : null,
    total: achados.length, itens: achados,
  });
});

r.get('/api/catalogo/:ean', (req, res, p) => {
  const prod = um('SELECT * FROM products WHERE ean = ? AND ativo = 1', p.ean);
  if (!prod) throw new Erro(404, 'PRODUTO_INEXISTENTE', 'Produto não encontrado');
  if (!CONFIG.receita_habilitada && (prod.requer_receita || prod.controlado_344)) {
    throw new Erro(404, 'FORA_DO_CATALOGO',
      'Por enquanto a Solmedic+ entrega só medicamento de venda livre');
  }
  json(res, 200, {
    ...prod,
    ofertas: todos(
      `SELECT f.id AS pharmacy_id, f.nome_fantasia, f.bairro, i.preco_centavos,
              i.preco_socio_centavos, i.preco_de_centavos, i.estoque, f.frete_centavos
         FROM inventory i JOIN pharmacies f ON f.id = i.pharmacy_id
        WHERE i.ean = ? AND i.ativo = 1 AND i.estoque > 0 AND f.status='ativa'
        ORDER BY i.preco_centavos`, p.ean),
  });
});

/**
 * Dados que a RDC 44/2009 obriga a exibir em toda página que recebe pedido:
 * razão social, nome fantasia, CNPJ, endereço, horário, telefone e o nome e
 * CRF do responsável técnico.
 */
r.get('/api/sintomas', (req, res) =>
  json(res, 200, { itens: SINTOMAS, ressalva: RESSALVA_SINTOMA }));

r.get('/api/farmacias/:id', (req, res, p) => {
  const f = um(`SELECT id,razao_social,nome_fantasia,cnpj,telefone,email,logradouro,numero,
                       bairro,cidade,uf,cep,dominio_afe,status
                  FROM pharmacies WHERE id = ? AND status = 'ativa'`, p.id);
  if (!f) throw new Erro(404, 'LOJA_INEXISTENTE', 'Farmácia não encontrada');
  const rt = um(`SELECT u.nome, pu.crf, pu.crf_uf FROM pharmacy_users pu
                   JOIN users u ON u.id = pu.user_id
                  WHERE pu.pharmacy_id = ? AND pu.responsavel_tecnico = 1 AND pu.ativo = 1`, p.id);
  json(res, 200, {
    ...f,
    responsavel_tecnico: rt ? { nome: rt.nome, crf: `CRF-${rt.crf_uf ?? ''} ${rt.crf}`.trim() } : null,
    horarios: todos('SELECT * FROM pharmacy_hours WHERE pharmacy_id = ? ORDER BY dia_semana', p.id),
  });
});

// Com loja própria, "lista de farmácias" é sempre uma. A rota fica porque o
// painel e os testes de cadastro dependem dela.
r.get('/api/farmacias', (req, res) => json(res, 200, todos(
  `SELECT id, nome_fantasia, bairro, cidade, uf, frete_centavos, frete_gratis_acima_centavos
     FROM pharmacies WHERE status='ativa' ORDER BY nome_fantasia`)));

/**
 * O que o app do cliente precisa saber antes de ter conta.
 *
 * A chave PIX NÃO entra aqui. Ela é usada só para montar o BR Code no
 * servidor; devolvê-la numa rota pública seria entregar, para qualquer
 * um que abrisse o endereço, o identificador da conta que recebe —
 * matéria-prima de golpe de QR falso.
 */
const CONFIG_PUBLICA = ['receita_habilitada', 'loja_propria', 'area', 'pix_habilitado'];

r.get('/api/config', (req, res) => {
  const loja = lojaDaCasa();
  const todas = todasConfigs();
  json(res, 200, {
    ...Object.fromEntries(CONFIG_PUBLICA.map((k) => [k, todas[k]])),
    farmacia: loja ? { id: loja.id, nome: loja.nome_fantasia, bairro: loja.bairro } : null,
  });
});

/** O interruptor. Ligar receita no dia da licença não pode exigir deploy. */
r.put('/api/admin/config', async (req, res) => {
  const admin = exigeAdmin(req);
  const b = await corpo(req);
  const mudou = {};
  for (const [chave, valor] of Object.entries(b)) {
    try { Object.assign(mudou, defineConfig(chave, valor, admin.id)); }
    catch (e) { throw new Erro(400, 'CHAVE_INVALIDA', e.message); }
  }
  json(res, 200, { ...todasConfigs(), alterado: Object.keys(mudou) });
});

// ============ o armário da casa ============
r.get('/api/armario', (req, res, _p, url) => {
  const u = exigeLogin(req);
  json(res, 200, {
    itens: armario.doCliente(u.id, { incluirEncerrados: url.searchParams.get('tudo') === '1' }),
    resumo: armario.resumo(u.id),
  });
});

r.put('/api/armario/:id', async (req, res, p) => {
  const u = exigeLogin(req);
  json(res, 200, armario.ajusta(p.id, u.id, await corpo(req)));
});

/** Recolhimento de lote. A parte que importa é a lista de quem foi avisado. */
r.post('/api/comercio/:pid/recalls', async (req, res, p) => {
  const { u } = exigeLoja(req, p.pid, ['farmaceutico', 'gerente']);
  const b = await corpo(req);
  json(res, 201, armario.registraRecall(b, u.id, p.pid));
});

r.get('/api/comercio/:pid/recalls', (req, res, p) => {
  exigeLoja(req, p.pid);
  json(res, 200, armario.listaRecalls());
});

/** Varredura de validade — em produção isto vira tarefa agendada. */
r.post('/api/admin/vencimentos', (req, res) => {
  exigeAdmin(req);
  json(res, 200, { avisados: armario.avisaVencimentos() });
});

// ============ PIX ============
r.post('/api/pedidos/:id/pix', async (req, res, p) => {
  const u = exigeLogin(req);
  const o = um('SELECT user_id FROM orders WHERE id = ?', p.id);
  if (!o || o.user_id !== u.id) throw new Erro(403, 'SEM_PERMISSAO', 'Esse pedido não é seu');
  json(res, 201, await pix.cobra(p.id));
});

/**
 * "Já paguei".
 *
 * Com o provedor ligado isto NÃO confia no cliente: pergunta ao banco se
 * a cobrança está concluída. Sem provedor, continua sendo a confirmação
 * manual de sempre — que é honesta enquanto não há quem confirme sozinho.
 */
r.post('/api/pedidos/:id/pix/confirmar', async (req, res, p) => {
  const u = exigeLogin(req);
  const o = um('SELECT user_id, codigo FROM orders WHERE id = ?', p.id);
  if (!o) throw new Erro(404, 'PEDIDO_INEXISTENTE', 'Pedido não encontrado');
  if (o.user_id !== u.id && u.papel_global !== 'admin') {
    throw new Erro(403, 'SEM_PERMISSAO', 'Esse pedido não é seu');
  }
  const b = await corpo(req);
  if (psp.ligado()) {
    const r2 = await psp.consulta(o.codigo.replace(/-/g, ''));
    if (!r2.pago) {
      throw new Erro(409, 'AINDA_NAO_CAIU',
        'O banco ainda não confirmou esse PIX. Se você acabou de pagar, espere alguns segundos.');
    }
    return json(res, 200, pix.confirma(p.id, { external_id: r2.e2e }));
  }
  json(res, 200, pix.confirma(p.id, b));
});

/**
 * Webhook do provedor: é ele que faz o pedido andar sozinho.
 *
 * Aceita o formato da API Pix do Banco Central (lista em `pix`) e também
 * um corpo simples com txid. Nunca acredita no valor que chega: confere
 * com o pedido antes de dar por pago.
 */
r.post('/api/webhooks/pix', async (req, res) => {
  psp.confereWebhook(req);
  const b = await corpo(req);
  const eventos = b.pix ?? [b];
  const pagos = [];
  for (const ev of eventos) {
    const txid = ev.txid ?? ev.transaction_id;
    if (!txid) continue;
    const codigo = txid.replace(/^CV/i, 'CV-');
    const o = um("SELECT id, total_centavos FROM orders WHERE replace(codigo, '-', '') = ?", txid)
      ?? um('SELECT id, total_centavos FROM orders WHERE codigo = ?', codigo);
    if (!o) continue;
    const centavos = ev.valor ? Math.round(Number(ev.valor) * 100) : o.total_centavos;
    if (centavos < o.total_centavos) continue;   // pagamento parcial não fecha pedido
    try {
      pix.confirma(o.id, { external_id: ev.endToEndId ?? ev.e2e ?? txid });
      pagos.push(o.id);
    } catch { /* já estava pago: webhook repetido é normal */ }
  }
  json(res, 200, { recebido: eventos.length, confirmados: pagos.length });
});

// ============ falar com o farmacêutico ============
r.get('/api/conversa', (req, res) => {
  const u = exigeLogin(req);
  const c = conversas.minha(u);
  conversas.marcaLidas(c.id, 'cliente');
  json(res, 200, { ...c, atalhos: conversas.ATALHOS, ressalva: conversas.RESSALVA });
});

r.post('/api/conversa', async (req, res) => {
  const u = exigeLogin(req);
  const b = await corpo(req);
  const c = conversas.minha(u, { assunto: b.assunto, orderId: b.order_id });
  json(res, 201, conversas.escreve(c.id, b.texto, { tipo: 'cliente', id: u.id, nome: u.nome }));
});

r.get('/api/conversa/:id/stream', (req, res, p) => abreSSE(req, res, `conversa:${p.id}`));

r.get('/api/comercio/:pid/conversas', (req, res, p, url) => {
  exigeLoja(req, p.pid, ['farmaceutico', 'gerente']);
  json(res, 200, url.searchParams.get('todas')
    ? conversas.historico(p.pid) : conversas.fila(p.pid));
});

r.post('/api/comercio/:pid/conversas/:id/responder', async (req, res, p) => {
  // orientação farmacêutica é privativa: só quem tem CRF responde
  const { u, vinculo } = exigeFarmaceutico(req, p.pid);
  const b = await corpo(req);
  conversas.marcaLidas(p.id, 'farmaceutico');
  json(res, 201, conversas.escreve(p.id, b.texto, {
    tipo: 'farmaceutico', id: u.id, nome: u.nome,
    crf: `CRF-${vinculo.crf_uf ?? ''} ${vinculo.crf}`.trim(),
  }));
});

r.post('/api/comercio/:pid/conversas/:id/fechar', (req, res, p) => {
  exigeFarmaceutico(req, p.pid);
  json(res, 200, conversas.fecha(p.id));
});

// ============ notificações ============
r.get('/api/push/chave', (req, res) => json(res, 200, { chave: chavesVapid().publica }));

r.post('/api/push/inscrever', async (req, res) => {
  const u = exigeLogin(req);
  const b = await corpo(req);
  if (!b.endpoint || !b.keys?.p256dh || !b.keys?.auth) {
    throw new Erro(400, 'INSCRICAO_INVALIDA', 'Inscrição de push incompleta');
  }
  roda(`INSERT INTO push_inscricoes (id,user_id,endpoint,p256dh,auth,aparelho,criado_em)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,
          p256dh=excluded.p256dh, auth=excluded.auth`,
    id(), u.id, b.endpoint, b.keys.p256dh, b.keys.auth, b.aparelho ?? null, agora());
  json(res, 201, { ok: true });
});

r.post('/api/push/sair', async (req, res) => {
  exigeLogin(req);
  const b = await corpo(req);
  roda('DELETE FROM push_inscricoes WHERE endpoint = ?', b.endpoint ?? '');
  json(res, 200, { ok: true });
});

/** Canal pessoal: notificação chega dentro do app sem precisar de push. */
r.get('/api/notificacoes/stream', (req, res, _p, url) => {
  const token = url.searchParams.get('t');
  const s = token ? um('SELECT user_id FROM sessions WHERE token = ?', token) : null;
  if (!s) throw new Erro(401, 'NAO_AUTENTICADO', 'Sessão inválida');
  abreSSE(req, res, `user:${s.user_id}`);
});

/** Dispara um aviso real, para a pessoa ver que está funcionando. */
r.post('/api/notificacoes/testar', async (req, res) => {
  const u = exigeLogin(req);
  await avisa.paraCliente(u.id, 'teste', null, {});
  json(res, 201, { ok: true, nao_lidas: avisa.naoLidas(u.id) });
});

r.get('/api/notificacoes', (req, res) => {
  const u = exigeLogin(req);
  json(res, 200, { itens: avisa.doCliente(u.id), nao_lidas: avisa.naoLidas(u.id) });
});

r.post('/api/notificacoes/lidas', (req, res) => {
  const u = exigeLogin(req);
  avisa.marcaLidas(u.id);
  json(res, 200, { ok: true });
});

/** A chave de privacidade: mostrar ou não o nome do remédio no aviso. */
r.put('/api/conta/preferencias', async (req, res) => {
  const u = exigeLogin(req);
  const b = await corpo(req);
  if (typeof b.push_detalhado === 'boolean') {
    roda('UPDATE users SET push_detalhado = ? WHERE id = ?', b.push_detalhado ? 1 : 0, u.id);
  }
  json(res, 200, um('SELECT id, nome, email, socio, push_detalhado FROM users WHERE id = ?', u.id));
});

// ============ a primeira tela, numa chamada só ============
r.get('/api/inicio', (req, res) => json(res, 200, inicio.monta(quemE(req))));

// ============ upload ============
// Guarda em disco, em data/uploads, e devolve a URL. Em produção isso vira
// S3/R2/Supabase Storage — muda só esta função.
const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const TIPOS_OK = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const LIMITE_BYTES = 8 * 1024 * 1024;

r.post('/api/upload', async (req, res) => {
  const u = exigeLogin(req);
  const b = await corpo(req);
  const m = /^data:([^;]+);base64,(.+)$/s.exec(b.arquivo ?? '');
  if (!m) throw new Erro(400, 'ARQUIVO_INVALIDO', 'Envie o arquivo como data URL base64');
  const ext = TIPOS_OK[m[1]];
  if (!ext) throw new Erro(415, 'TIPO_NAO_ACEITO', 'Aceitamos JPG, PNG, WEBP ou PDF');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > LIMITE_BYTES) {
    throw new Erro(413, 'ARQUIVO_GRANDE', 'O arquivo passa de 8 MB — tire a foto com menos resolução');
  }
  const pasta = b.pasta === 'docs' ? 'docs' : 'receitas';
  const nome = `${pasta}/${u.id}/${id()}.${ext}`;
  const destino = join(RAIZ, 'data', 'uploads', nome);
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, bytes);
  json(res, 201, { url: `/uploads/${nome}`, bytes: bytes.length });
});

// ============ endereços ============
r.get('/api/enderecos', (req, res) => {
  const u = exigeLogin(req);
  json(res, 200, todos('SELECT * FROM addresses WHERE user_id = ? ORDER BY padrao DESC', u.id));
});

r.post('/api/enderecos', async (req, res) => {
  const u = exigeLogin(req);
  const b = await corpo(req);
  if (!b.logradouro || !b.bairro) throw new Erro(400, 'ENDERECO_INCOMPLETO', 'Logradouro e bairro são obrigatórios');
  const aid = id();
  roda(`INSERT INTO addresses (id,user_id,apelido,logradouro,numero,complemento,bairro,cidade,uf,cep,lat,lng,padrao)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    aid, u.id, b.apelido ?? 'Casa', b.logradouro, b.numero ?? null, b.complemento ?? null,
    b.bairro, b.cidade ?? 'Fortaleza', b.uf ?? 'CE', b.cep ?? null, b.lat ?? null, b.lng ?? null,
    b.padrao ? 1 : 0);
  json(res, 201, um('SELECT * FROM addresses WHERE id = ?', aid));
});

// ============ carrinho e pedidos (cliente) ============
r.post('/api/carrinho/orcamento', async (req, res) => {
  const u = quemE(req);
  const b = await corpo(req);
  json(res, 200, pedidos.orcamento({ pharmacyId: b.pharmacy_id, itens: b.itens ?? [],
    socio: !!u?.socio, userId: u?.id ?? null }));
});

r.post('/api/pedidos', async (req, res) => {
  const u = exigeLogin(req);
  const b = await corpo(req);
  json(res, 201, pedidos.cria({
    user: u, addressId: b.address_id, pharmacyId: b.pharmacy_id, itens: b.itens ?? [],
    metodo: b.metodo, cartaoFinal: b.cartao_final, prescriptionId: b.prescription_id ?? null,
  }));
});

r.get('/api/pedidos', (req, res) => {
  const u = exigeLogin(req);
  json(res, 200, todos(
    `SELECT id, codigo, status, total_centavos, criado_em FROM orders
      WHERE user_id = ? ORDER BY criado_em DESC LIMIT 50`, u.id));
});

r.get('/api/pedidos/:id', (req, res, p) => {
  const u = exigeLogin(req);
  const d = pedidos.detalhe(p.id);
  if (d.user_id !== u.id && u.papel_global !== 'admin') {
    throw new Erro(403, 'SEM_PERMISSAO', 'Esse pedido não é seu');
  }
  json(res, 200, { ...d, linha_do_tempo: linhaDoTempo(p.id) });
});

r.get('/api/avaliacoes/marcas', (req, res) => json(res, 200, avaliacoes.MARCAS));

r.post('/api/pedidos/:id/avaliar', async (req, res, p) => {
  const u = exigeLogin(req);
  const b = await corpo(req);
  json(res, 201, avaliacoes.avalia(p.id, {
    nota: b.nota, notaEntrega: b.nota_entrega, marcas: b.marcas ?? [],
    comentario: b.comentario, gorjeta: b.gorjeta_centavos ?? 0,
  }, u));
});

r.get('/api/comercio/:pid/reputacao', (req, res, p) => {
  exigeLoja(req, p.pid);
  json(res, 200, avaliacoes.daLoja(p.pid));
});

r.get('/api/pedidos/:id/stream', (req, res, p) => abreSSE(req, res, `pedido:${p.id}`));

r.post('/api/pedidos/:id/ofertas/:ofertaId', async (req, res, p) => {
  const u = exigeLogin(req);
  const b = await corpo(req);
  json(res, 200, pedidos.respondeOferta(p.id, p.ofertaId, !!b.aceitar,
    { tipo: 'cliente', id: u.id, nome: u.nome }));
});

r.post('/api/pedidos/:id/cancelar', async (req, res, p) => {
  const u = exigeLogin(req);
  const b = await corpo(req);
  json(res, 200, pedidos.cancela(p.id, { tipo: 'cliente', id: u.id, nome: u.nome },
    b.motivo ?? 'Cancelado pelo cliente'));
});

// ============ receitas (cliente) ============
r.post('/api/receitas', async (req, res) => {
  const u = exigeLogin(req);
  const b = await corpo(req);
  json(res, 201, receitas.envia({
    user: u, arquivoUrl: b.arquivo_url, itens: b.itens ?? [], prescritor: b.prescritor ?? {},
    emitidaEm: b.emitida_em, validaAte: b.valida_ate, usoContinuo: b.uso_continuo,
    origem: b.origem ?? 'papel', plataforma: b.plataforma ?? null,
    codigoValidacao: b.codigo_validacao ?? null, tipoAssinatura: b.tipo_assinatura ?? null,
    numeroSncr: b.numero_sncr ?? null,
    // sem loja escolhida, a receita vai para a farmácia que o app já selecionou
    pharmacyId: b.pharmacy_id ?? inicio.monta(u).farmacia?.id ?? null,
  }));
});

r.get('/api/receitas', (req, res) => json(res, 200, receitas.doCliente(exigeLogin(req).id)));

r.get('/api/receitas/:id', (req, res, p) => {
  const u = exigeLogin(req);
  const rec = receitas.detalhe(p.id);
  if (rec.user_id !== u.id && !u.lojas?.length && u.papel_global !== 'admin') {
    throw new Erro(403, 'SEM_PERMISSAO', 'Receita é dado sensível de saúde');
  }
  registraAcesso(u.id, 'prescription', p.id, 'leitura', ip(req));
  json(res, 200, rec);
});

// ============ o comércio ============
r.post('/api/comercio/cadastro', async (req, res) => json(res, 201, comercio.cadastra(await corpo(req))));

r.get('/api/comercio/:pid', (req, res, p) => {
  exigeLoja(req, p.pid, ['gerente', 'operador', 'farmaceutico']);
  json(res, 200, comercio.ficha(p.pid));
});

r.post('/api/comercio/:pid/docs', async (req, res, p) => {
  exigeLoja(req, p.pid, ['gerente']);
  json(res, 201, comercio.anexaDoc(p.pid, await corpo(req)));
});

r.post('/api/comercio/:pid/submeter', (req, res, p) => {
  exigeLoja(req, p.pid, ['gerente']);
  json(res, 200, comercio.submete(p.pid));
});

r.post('/api/comercio/:pid/equipe', async (req, res, p) => {
  exigeLoja(req, p.pid, ['gerente']);
  json(res, 201, comercio.adicionaMembro(p.pid, await corpo(req)));
});

r.get('/api/comercio/:pid/catalogo', (req, res, p, url) => {
  exigeLoja(req, p.pid);
  json(res, 200, comercio.catalogo(p.pid, { q: url.searchParams.get('q') || '' }));
});

r.post('/api/comercio/:pid/catalogo', async (req, res, p) => {
  exigeLoja(req, p.pid, ['gerente', 'operador']);
  json(res, 200, comercio.defineItem(p.pid, await corpo(req)));
});

r.post('/api/comercio/:pid/catalogo/importar', async (req, res, p) => {
  exigeLoja(req, p.pid, ['gerente']);
  const b = await corpo(req);
  json(res, 200, comercio.importaCSV(p.pid, b.csv ?? ''));
});

r.get('/api/comercio/:pid/ruptura', (req, res, p) => {
  exigeLoja(req, p.pid);
  json(res, 200, comercio.previsaoDeRuptura(p.pid));
});

r.get('/api/comercio/:pid/indicadores', (req, res, p) => {
  exigeLoja(req, p.pid);
  json(res, 200, comercio.indicadores(p.pid));
});

// ---- fila de pedidos da loja ----
r.get('/api/comercio/:pid/pedidos', (req, res, p, url) => {
  exigeLoja(req, p.pid);
  const status = url.searchParams.get('status');
  const lista = todos(
    `SELECT id FROM orders WHERE pharmacy_id = ?
       AND (? IS NULL OR status = ?)
       AND status NOT IN ('entregue','cancelado')
     ORDER BY criado_em`, p.pid, status, status);
  json(res, 200, lista.map((o) => pedidos.detalhe(o.id)));
});

r.get('/api/comercio/:pid/stream', (req, res, p) => abreSSE(req, res, `loja:${p.pid}`));

r.post('/api/comercio/:pid/pedidos/:oid/aceitar', (req, res, p) => {
  const { u, vinculo } = exigeLoja(req, p.pid, ['gerente', 'operador']);
  json(res, 200, pedidos.aceita(p.oid, { tipo: 'loja', id: u.id, nome: u.nome }));
});

r.post('/api/comercio/:pid/pedidos/:oid/recusar', async (req, res, p) => {
  const { u } = exigeLoja(req, p.pid, ['gerente', 'operador']);
  const b = await corpo(req);
  if (!b.motivo) throw new Erro(422, 'MOTIVO_OBRIGATORIO', 'Diga por que está recusando o pedido');
  json(res, 200, pedidos.cancela(p.oid, { tipo: 'loja', id: u.id, nome: u.nome }, b.motivo));
});

r.post('/api/comercio/:pid/pedidos/:oid/itens/:itemId/indisponivel', (req, res, p) => {
  const { u } = exigeLoja(req, p.pid, ['gerente', 'operador']);
  json(res, 200, pedidos.marcaIndisponivel(p.oid, p.itemId, { tipo: 'loja', id: u.id, nome: u.nome }));
});

r.post('/api/comercio/:pid/pedidos/:oid/itens/:itemId/substituir', async (req, res, p) => {
  const { u } = exigeLoja(req, p.pid, ['gerente', 'operador']);
  const b = await corpo(req);
  json(res, 200, pedidos.ofereceSubstituto(p.oid, p.itemId, b.ean,
    { tipo: 'loja', id: u.id, nome: u.nome }));
});

r.post('/api/comercio/:pid/pedidos/:oid/pronto', async (req, res, p) => {
  const { u } = exigeLoja(req, p.pid, ['gerente', 'operador']);
  const b = await corpo(req);
  json(res, 200, pedidos.marcaPronto(p.oid, { tipo: 'loja', id: u.id, nome: u.nome }, b.conferencia ?? []));
});

r.post('/api/comercio/:pid/pedidos/:oid/despachar', async (req, res, p) => {
  const { u } = exigeLoja(req, p.pid, ['gerente', 'operador']);
  const b = await corpo(req);
  json(res, 200, pedidos.despacha(p.oid, b.courier_id, { tipo: 'loja', id: u.id, nome: u.nome }));
});

// ---- fila do farmacêutico ----
r.get('/api/comercio/:pid/receitas', (req, res, p) => {
  const { u } = exigeLoja(req, p.pid, ['farmaceutico', 'gerente']);
  const fila = receitas.fila(p.pid);
  for (const rec of fila) registraAcesso(u.id, 'prescription', rec.id, 'leitura', ip(req));
  json(res, 200, fila);
});

r.post('/api/comercio/:pid/receitas/:rid/liberar', (req, res, p) => {
  const ctx = exigeFarmaceutico(req, p.pid);
  json(res, 200, receitas.libera(p.rid, ctx, p.pid, ip(req)));
});

r.get('/api/comercio/:pid/receitas/retencao', (req, res, p) => {
  exigeLoja(req, p.pid, ['farmaceutico', 'gerente']);
  json(res, 200, receitas.filaRetencao(p.pid));
});

// o farmacêutico lê o papel e preenche o que a foto não diz
r.post('/api/comercio/:pid/receitas/:rid/preencher', async (req, res, p) => {
  const ctx = exigeFarmaceutico(req, p.pid);
  json(res, 200, receitas.preenche(p.rid, await corpo(req), ctx));
});

// a prova da retenção: registro, quantidade, lote e validade
r.post('/api/comercio/:pid/receitas/:rid/retencao', async (req, res, p) => {
  const ctx = exigeFarmaceutico(req, p.pid);
  json(res, 201, receitas.registraRetencao(p.rid, await corpo(req), ctx, p.pid, ip(req)));
});

r.post('/api/comercio/:pid/receitas/:rid/recusar', async (req, res, p) => {
  const ctx = exigeFarmaceutico(req, p.pid);
  const b = await corpo(req);
  json(res, 200, receitas.recusa(p.rid, b.motivo, ctx, p.pid, ip(req)));
});

// ---- financeiro da loja ----
r.get('/api/comercio/:pid/repasses', (req, res, p) => {
  exigeLoja(req, p.pid, ['gerente']);
  json(res, 200, todos('SELECT * FROM payouts WHERE pharmacy_id=? ORDER BY periodo_fim DESC', p.pid));
});

r.post('/api/comercio/:pid/repasses/fechar', async (req, res, p) => {
  exigeLoja(req, p.pid, ['gerente']);
  const b = await corpo(req);
  json(res, 201, comercio.fechaRepasse(p.pid, b.inicio, b.fim));
});

// ============ entregador ============
r.get('/api/entregador/tarefas', (req, res) => {
  const u = exigeLogin(req);
  if (!u.entregador) throw new Erro(403, 'NAO_E_ENTREGADOR', 'Sua conta não é de entregador');
  json(res, 200, todos(
    `SELECT o.id, o.codigo, o.status, d.exige_maos, d.exige_termica, d.status AS entrega_status,
            f.nome_fantasia, f.logradouro AS coleta, a.logradouro, a.numero, a.bairro
       FROM orders o
       JOIN deliveries d ON d.order_id = o.id
       JOIN pharmacies f ON f.id = o.pharmacy_id
       JOIN addresses a ON a.id = o.address_id
      WHERE o.status IN ('pronto','em_rota')
        AND (d.courier_id IS NULL OR d.courier_id = ?)
        AND (f.id = ? OR ? IS NULL)
      ORDER BY o.separado_em`, u.entregador.id, u.entregador.pharmacy_id, u.entregador.pharmacy_id));
});

r.post('/api/entregador/entregas/:oid/retirar', (req, res, p) => {
  const u = exigeLogin(req);
  if (!u.entregador) throw new Erro(403, 'NAO_E_ENTREGADOR', 'Sua conta não é de entregador');
  json(res, 200, pedidos.despacha(p.oid, u.entregador.id,
    { tipo: 'entregador', id: u.id, nome: u.nome }));
});

r.post('/api/entregador/entregas/:oid/entregar', async (req, res, p) => {
  const u = exigeLogin(req);
  if (!u.entregador) throw new Erro(403, 'NAO_E_ENTREGADOR', 'Sua conta não é de entregador');
  const b = await corpo(req);
  json(res, 200, pedidos.entrega(p.oid,
    { recebidoPor: b.recebido_por, doc: b.documento, fotoUrl: b.foto_url,
      receitaColetada: !!b.receita_coletada },
    { tipo: 'entregador', id: u.id, nome: u.nome }));
});

// ============ admin da plataforma ============
r.get('/api/admin/farmacias', (req, res, _p, url) => {
  exigeAdmin(req);
  const st = url.searchParams.get('status');
  json(res, 200, todos(
    `SELECT id FROM pharmacies WHERE (? IS NULL OR status = ?) ORDER BY criado_em DESC`, st, st)
    .map((f) => comercio.ficha(f.id)));
});

r.post('/api/admin/farmacias/:pid/decidir', async (req, res, p) => {
  const admin = exigeAdmin(req);
  const b = await corpo(req);
  json(res, 200, comercio.decide(p.pid, !!b.aprovar, b.motivo, admin.id));
});

/**
 * Ponto de batida para o cron externo.
 *
 * O plano gratuito do Render hiberna depois de 15 minutos parado, e a
 * primeira visita depois disso espera quase um minuto. Um cron-job.org
 * batendo aqui a cada 10 minutos mantém o serviço acordado. É de
 * propósito a rota mais barata do sistema: não toca no banco.
 */
r.get('/api/ping', (req, res) => json(res, 200, { ok: true, em: agora() }));

r.get('/api/admin/indicadores', (req, res) => {
  exigeAdmin(req);
  const tot = um(`SELECT COUNT(*) AS n, COALESCE(SUM(total_centavos),0) AS gmv,
                         COALESCE(SUM(comissao_centavos),0) AS receita
                    FROM orders WHERE status='entregue'`);
  json(res, 200, {
    gmv_centavos: tot.gmv, receita_centavos: tot.receita, pedidos_entregues: tot.n,
    farmacias_ativas: um(`SELECT COUNT(*) AS n FROM pharmacies WHERE status='ativa'`).n,
    farmacias_em_analise: um(`SELECT COUNT(*) AS n FROM pharmacies WHERE status='em_analise'`).n,
    clientes: um(`SELECT COUNT(*) AS n FROM users WHERE papel_global='cliente'`).n,
    ticket_medio_centavos: tot.n ? Math.round(tot.gmv / tot.n) : 0,
  });
});

// ============ estoque ============
// Ler é de qualquer um da equipe; mexer no saldo é de gerente e farmacêutico.
// Balconista não ajusta estoque sozinho — é assim que sumiço vira "ajuste".

r.get('/api/comercio/:pid/estoque', (req, res, p, url) => {
  exigeLoja(req, p.pid);
  json(res, 200, estoque.posicao(p.pid, {
    q: url.searchParams.get('q') || '', filtro: url.searchParams.get('filtro') || 'todos' }));
});

r.get('/api/comercio/:pid/estoque/resumo', (req, res, p) => {
  exigeLoja(req, p.pid);
  json(res, 200, estoque.resumo(p.pid));
});

r.get('/api/comercio/:pid/estoque/vencendo', (req, res, p, url) => {
  exigeLoja(req, p.pid);
  json(res, 200, estoque.lotesVencendo(p.pid, Number(url.searchParams.get('dias')) || 90));
});

r.get('/api/comercio/:pid/estoque/movimentos', (req, res, p, url) => {
  exigeLoja(req, p.pid);
  json(res, 200, estoque.movimentos(p.pid, Number(url.searchParams.get('limite')) || 60));
});

r.get('/api/comercio/:pid/estoque/abc', (req, res, p) => {
  exigeLoja(req, p.pid);
  json(res, 200, estoque.abc(p.pid));
});

r.get('/api/comercio/:pid/estoque/conferencia', (req, res, p) => {
  exigeLoja(req, p.pid);
  json(res, 200, estoque.conferencia(p.pid));
});

r.post('/api/comercio/:pid/estoque/entrada', async (req, res, p) => {
  const { u } = exigeLoja(req, p.pid, ['gerente', 'farmaceutico', 'operador']);
  json(res, 201, estoque.entrada(p.pid, await corpo(req), u.id));
});

r.post('/api/comercio/:pid/estoque/contagem', async (req, res, p) => {
  const { u } = exigeLoja(req, p.pid, ['gerente', 'farmaceutico']);
  json(res, 200, estoque.contagem(p.pid, await corpo(req), u.id));
});

r.post('/api/comercio/:pid/estoque/perda', async (req, res, p) => {
  const { u } = exigeLoja(req, p.pid, ['gerente', 'farmaceutico']);
  json(res, 200, estoque.perda(p.pid, await corpo(req), u.id));
});

r.get('/api/comercio/:pid/estoque/:ean/lotes', (req, res, p) => {
  exigeLoja(req, p.pid);
  json(res, 200, estoque.lotesDo(p.pid, p.ean));
});

r.get('/api/comercio/:pid/estoque/:ean/kardex', (req, res, p) => {
  exigeLoja(req, p.pid);
  json(res, 200, estoque.kardex(p.pid, p.ean));
});

// ============ CRM ============
// A ordem importa: o roteador casa por número de segmentos, então as
// rotas com nome fixo precisam vir antes de /clientes/:uid.

r.get('/api/comercio/:pid/clientes/segmentos', (req, res, p) => {
  exigeLoja(req, p.pid);
  json(res, 200, crm.segmentos(p.pid));
});

r.get('/api/comercio/:pid/clientes/recompras', (req, res, p) => {
  exigeLoja(req, p.pid);
  json(res, 200, crm.recompras(p.pid));
});

r.get('/api/comercio/:pid/clientes', (req, res, p, url) => {
  exigeLoja(req, p.pid);
  json(res, 200, crm.lista(p.pid, {
    q: url.searchParams.get('q') || '',
    segmento: url.searchParams.get('segmento') || '',
    ordem: url.searchParams.get('ordem') || 'recentes' }));
});

r.get('/api/comercio/:pid/clientes/:uid', (req, res, p) => {
  exigeLoja(req, p.pid);
  json(res, 200, crm.ficha(p.pid, p.uid));
});

r.post('/api/comercio/:pid/clientes/:uid/notas', async (req, res, p) => {
  const { u } = exigeLoja(req, p.pid);
  json(res, 201, crm.anota(p.pid, p.uid, await corpo(req), u.id));
});

r.del('/api/comercio/:pid/clientes/notas/:nid', (req, res, p) => {
  exigeLoja(req, p.pid, ['gerente', 'farmaceutico']);
  json(res, 200, crm.apagaNota(p.pid, p.nid));
});

r.post('/api/comercio/:pid/clientes/:uid/marcas', async (req, res, p) => {
  exigeLoja(req, p.pid);
  const b = await corpo(req);
  json(res, 200, crm.marca(p.pid, p.uid, b.marca, b.ligar !== false));
});

r.get('/api/comercio/:pid/campanhas', (req, res, p) => {
  exigeLoja(req, p.pid);
  json(res, 200, crm.historicoCampanhas(p.pid));
});

r.post('/api/comercio/:pid/campanhas', async (req, res, p) => {
  const { u } = exigeLoja(req, p.pid, ['gerente', 'farmaceutico']);
  json(res, 201, await crm.campanha(p.pid, await corpo(req), u.id));
});

r.get('/api/comercio/:pid/visao', (req, res, p) => {
  exigeLoja(req, p.pid);
  json(res, 200, {
    ...comercio.visao(p.pid),
    estoque: estoque.resumo(p.pid),
    segmentos: crm.segmentos(p.pid),
    recompras: crm.recompras(p.pid, { limite: 6 }),
    vencendo: estoque.lotesVencendo(p.pid, 60).slice(0, 6),
    ruptura: comercio.previsaoDeRuptura(p.pid).slice(0, 6),
  });
});

/** Dados da loja: nome, endereço, frete, raio. O dono muda sem pedir nada. */
r.put('/api/comercio/:pid', async (req, res, p) => {
  exigeLoja(req, p.pid, ['gerente']);
  json(res, 200, comercio.atualiza(p.pid, await corpo(req)));
});

r.put('/api/comercio/:pid/horarios', async (req, res, p) => {
  exigeLoja(req, p.pid, ['gerente']);
  const b = await corpo(req);
  json(res, 200, comercio.defineHorario(p.pid, b.dias ?? []));
});

// ============ foto do produto ============
// Foto de medicamento é do fabricante. O sistema guarda a que a loja tem
// direito de usar — a que o balconista tirou, ou a do kit de mídia.
r.post('/api/comercio/:pid/catalogo/:ean/foto', async (req, res, p) => {
  exigeLoja(req, p.pid, ['gerente', 'operador', 'farmaceutico']);
  json(res, 200, await fotos.salva(p.ean, await corpo(req)));
});

r.del('/api/comercio/:pid/catalogo/:ean/foto', async (req, res, p) => {
  exigeLoja(req, p.pid, ['gerente', 'operador', 'farmaceutico']);
  json(res, 200, await fotos.apaga(p.ean));
});

/**
 * A área de entrega é da loja, não da plataforma.
 * Enquanto a operação é de loja única, quem manda no alcance é o gerente —
 * pedir admin para acrescentar um bairro seria burocracia inventada.
 */
r.put('/api/comercio/:pid/area', async (req, res, p) => {
  exigeLoja(req, p.pid, ['gerente']);
  const b = await corpo(req);
  const area = (b.area ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (!area.length) throw new Erro(422, 'AREA_VAZIA', 'A loja precisa atender pelo menos um bairro');
  json(res, 200, defineConfig('area', area));
});

// ============================================================
// APP DO ENTREGADOR
// ============================================================

/** Quem sou eu, que loja me contratou, e se estou rastreável. */
r.get('/api/entregador/eu', (req, res) => {
  const u = exigeLogin(req);
  const c = entregas.meuCadastro(u.id);
  if (!c) throw new Erro(403, 'NAO_E_ENTREGADOR', 'Sua conta não é de entregador');
  json(res, 200, { ...c, usuario: { id: u.id, nome: u.nome, email: u.email } });
});

r.post('/api/entregador/turno', async (req, res) => {
  const u = exigeLogin(req);
  const c = entregas.meuCadastro(u.id);
  if (!c) throw new Erro(403, 'NAO_E_ENTREGADOR', 'Sua conta não é de entregador');
  const b = await corpo(req);
  json(res, 200, entregas.turno(c.id, b.entrando !== false));
});

/** A fila: o que já é meu e o que está no balcão esperando alguém. */
r.get('/api/entregador/fila', (req, res) => {
  const u = exigeLogin(req);
  const c = entregas.meuCadastro(u.id);
  if (!c) throw new Erro(403, 'NAO_E_ENTREGADOR', 'Sua conta não é de entregador');
  json(res, 200, { ...entregas.fila(c), loja: {
    nome: c.nome_fantasia, lat: c.loja_lat, lng: c.loja_lng,
    rua: c.loja_rua, numero: c.loja_numero } });
});

/**
 * A batida de posição.
 *
 * Responde 200 mesmo quando descarta — o aparelho não precisa saber se a
 * loja desligou o rastreamento para continuar funcionando, e devolver
 * erro faria o app dele encher a tela de alerta inútil na rua.
 */
r.post('/api/entregador/posicao', async (req, res) => {
  const u = exigeLogin(req);
  const c = entregas.meuCadastro(u.id);
  if (!c) throw new Erro(403, 'NAO_E_ENTREGADOR', 'Sua conta não é de entregador');
  json(res, 200, entregas.registraPosicao(c.id, await corpo(req)));
});

/** Onde está a moto — lido pelo cliente que espera o pedido. */
r.get('/api/pedidos/:id/entregador', (req, res, p) => {
  const u = exigeLogin(req);
  const o = um('SELECT user_id FROM orders WHERE id = ?', p.id);
  if (!o || o.user_id !== u.id) throw new Erro(403, 'SEM_PERMISSAO', 'Esse pedido não é seu');
  json(res, 200, entregas.posicaoDoPedido(p.id) ?? { rastreando: false });
});

// ---- frota, do lado da loja ----
r.get('/api/comercio/:pid/entregadores', (req, res, p) => {
  exigeLoja(req, p.pid);
  json(res, 200, entregas.listaDaLoja(p.pid));
});

r.post('/api/comercio/:pid/entregadores', async (req, res, p) => {
  exigeLoja(req, p.pid, ['gerente']);
  const b = await corpo(req);
  const criaConta = ({ nome, email, senha, telefone }) => {
    const uid = id();
    roda(`INSERT INTO users (id,nome,email,telefone,senha_hash,papel_global,socio,criado_em)
          VALUES (?,?,?,?,?,'cliente',0,?)`,
      uid, nome, email, telefone ?? null, hashSenha(senha || 'entrega123'), agora());
    return uid;
  };
  json(res, 201, entregas.salvaEntregador(p.pid, b, criaConta));
});

/** Apurar o ponto de um endereço que já existe — é o GPS corrigindo o CEP. */
r.put('/api/enderecos/:id', async (req, res, p) => {
  const u = exigeLogin(req);
  const a = um('SELECT * FROM addresses WHERE id = ? AND user_id = ?', p.id, u.id);
  if (!a) throw new Erro(404, 'ENDERECO_INEXISTENTE', 'Esse endereço não é seu');
  const b = await corpo(req);
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Erro(422, 'COORDENADA_INVALIDA', 'Coordenada inválida');
  }
  roda('UPDATE addresses SET lat = ?, lng = ? WHERE id = ?', lat, lng, p.id);
  json(res, 200, um('SELECT * FROM addresses WHERE id = ?', p.id));
});

/** Onde está cada moto da frota agora — é o que o painel desenha no mapa. */
r.get('/api/comercio/:pid/frota/posicoes', (req, res, p) => {
  exigeLoja(req, p.pid);
  json(res, 200, todos(
    `SELECT c.id, c.nome, c.veiculo, c.placa, c.ultima_lat AS lat, c.ultima_lng AS lng,
            c.ultima_em,
            (SELECT o.codigo FROM deliveries d JOIN orders o ON o.id = d.order_id
              WHERE d.courier_id = c.id AND o.status = 'em_rota' LIMIT 1) AS levando,
            (SELECT COUNT(*) FROM deliveries d JOIN orders o ON o.id = d.order_id
              WHERE d.courier_id = c.id AND o.status = 'em_rota') AS em_rota
       FROM couriers c
      WHERE c.pharmacy_id = ? AND c.ativo = 1 AND c.em_turno = 1
        AND c.rastreavel = 1 AND c.ultima_lat IS NOT NULL`, p.pid));
});

/**
 * O alerta que faltava para fechar o ciclo da operação.
 *
 * Pedido pronto no balcão e ninguém em turno é a falha silenciosa mais
 * cara da casa: o cliente espera, a loja acha que despachou, e só se
 * descobre quando ele liga reclamando. A varredura roda junto com a
 * consulta da fila, que o painel faz de qualquer jeito.
 */
r.get('/api/comercio/:pid/alertas', (req, res, p) => {
  exigeLoja(req, p.pid);
  const prontos = um(
    `SELECT COUNT(*) AS n FROM orders WHERE pharmacy_id = ? AND status = 'pronto'`, p.pid).n;
  const emTurno = um(
    `SELECT COUNT(*) AS n FROM couriers WHERE pharmacy_id = ? AND ativo = 1 AND em_turno = 1`,
    p.pid).n;
  const parados = todos(
    `SELECT codigo, separado_em FROM orders
      WHERE pharmacy_id = ? AND status = 'pronto'
        AND separado_em <= datetime('now','-20 minutes')`, p.pid);

  json(res, 200, {
    prontos, entregadores_em_turno: emTurno,
    sem_entregador: prontos > 0 && emTurno === 0,
    parados_ha_20min: parados,
  });
});

// ============ cadastro de produto pela loja ============
r.post('/api/comercio/:pid/produtos', async (req, res, p) => {
  const { u } = exigeLoja(req, p.pid, ['gerente', 'farmaceutico']);
  json(res, 201, comercio.salvaProduto(p.pid, await corpo(req), u.id));
});

r.get('/api/comercio/:pid/produtos/:ean', (req, res, p) => {
  exigeLoja(req, p.pid);
  const prod = um(
    `SELECT pr.*, i.preco_centavos, i.preco_de_centavos, i.estoque, i.posicao,
            i.ativo AS ativo_na_loja
       FROM products pr LEFT JOIN inventory i ON i.ean = pr.ean AND i.pharmacy_id = ?
      WHERE pr.ean = ?`, p.pid, p.ean);
  if (!prod) throw new Erro(404, 'PRODUTO_INEXISTENTE', 'Esse produto não existe');
  json(res, 200, prod);
});

r.post('/api/comercio/:pid/produtos/:ean/arquivar', async (req, res, p) => {
  exigeLoja(req, p.pid, ['gerente', 'farmaceutico']);
  const b = await corpo(req);
  json(res, 200, comercio.arquivaProduto(p.pid, p.ean, b.ativo !== false));
});
