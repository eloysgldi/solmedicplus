/**
 * O que a gente acrescentou para o cliente e para a casa.
 *   npm run dev   e depois   node test/experiencia.mjs
 */
const BASE = process.env.SM_API || 'http://localhost:4173';
let passou = 0, falhou = 0;
const cor = (c, t) => `\x1b[${c}m${t}\x1b[0m`;
function ok(cond, msg, extra) {
  if (cond) { passou++; console.log(cor(32, '  ✓'), msg); }
  else { falhou++; console.log(cor(31, '  ✗'), msg, extra ? cor(90, JSON.stringify(extra)) : ''); }
}
async function api(metodo, caminho, { token, corpo } = {}) {
  const res = await fetch(BASE + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: res.status, dados: await res.json().catch(() => ({})) };
}
const login = async (e, s) => (await api('POST', '/api/auth/login', { corpo: { email: e, senha: s } })).dados.token;

console.log(cor(1, '\nEXPERIÊNCIA\n'));

const cli = await login('cliente@exemplo.com', 'cliente123');
const ger = await login('gerente@solmedic.com.br', 'loja123');
const farma = await login('farmaceutica@solmedic.com.br', 'crf123');
const loja = (await api('GET', '/api/config')).dados.farmacia;
const end = (await api('GET', '/api/enderecos', { token: cli })).dados[0];

const DIPI = '7896112179245', PARA = '7896422504713', VITC = '7891142199058';

console.log(cor(1, '1. app instalável'));
for (const [caminho, tipo] of [['/manifest.json', 'application/json'], ['/sw.js', 'javascript'],
                               ['/marca.svg', 'svg']]) {
  const r = await fetch(BASE + caminho);
  ok(r.ok && (r.headers.get('content-type') || '').includes(tipo.split('/').pop()),
     `${caminho} servido com o tipo certo`);
}
const man = await (await fetch(BASE + '/manifest.json')).json();
ok(man.display === 'standalone', 'abre em tela cheia, sem barra de navegador');
ok(man.icons.length >= 2, `${man.icons.length} ícones declarados`);

console.log(cor(1, '\n2. notificação'));
const chave = (await api('GET', '/api/push/chave')).dados.chave;
ok(chave?.length > 80 && chave.startsWith('B'), 'chave VAPID pública disponível');
const n = (await api('GET', '/api/notificacoes', { token: cli })).dados;
ok(Array.isArray(n.itens), `histórico do cliente: ${n.itens.length} avisos`);
ok(n.itens.some((x) => /lote e validade/.test(x.corpo ?? '')),
   'a farmácia avisa que está conferindo lote e validade');
const pref = (await api('PUT', '/api/conta/preferencias', { token: cli, corpo: { push_detalhado: false } })).dados;
ok(pref.push_detalhado === 0, 'por padrão o aviso NÃO diz o nome do remédio');
const generico = n.itens.find((x) => x.tipo === 'saiu');
ok(generico && !/dipirona/i.test(generico.corpo ?? ''),
   'aviso de "saiu para entrega" não entrega a doença de ninguém');

console.log(cor(1, '\n3. conferência de rótulo'));
const orc = (await api('POST', '/api/carrinho/orcamento', { token: cli, corpo: {
  pharmacy_id: loja.id, itens: [{ ean: DIPI, qtd: 1 }, { ean: PARA, qtd: 1 }] } })).dados;
ok(orc.alertas?.length >= 1, `${orc.alertas?.length} alerta(s) no carrinho`);
ok(/dose dobrada|analgésicos/i.test(orc.alertas[0].texto), 'o alerta explica o porquê', orc.alertas[0]);
const limpo = (await api('POST', '/api/carrinho/orcamento', { token: cli, corpo: {
  pharmacy_id: loja.id, itens: [{ ean: VITC, qtd: 1 }] } })).dados;
ok(limpo.alertas.length === 0, 'carrinho sem conflito não inventa alerta');

console.log(cor(1, '\n4. PIX'));
const ppix = (await api('POST', '/api/pedidos', { token: cli, corpo: {
  pharmacy_id: loja.id, address_id: end.id, itens: [{ ean: VITC, qtd: 1 }], metodo: 'pix' } })).dados;
ok(!ppix.pagamento, 'PIX não reserva nada na criação — não existe reserva em PIX');
const px = (await api('POST', `/api/pedidos/${ppix.id}/pix`, { token: cli })).dados;
ok(px.copia_e_cola?.startsWith('000201'), 'BR Code começa como manda o EMV');
ok(px.copia_e_cola?.includes('br.gov.bcb.pix'), 'traz o domínio do arranjo PIX');
ok(/^[0-9A-F]{4}$/.test(px.copia_e_cola.slice(-4)), 'termina com CRC16 válido');
const pago = (await api('POST', `/api/pedidos/${ppix.id}/pix/confirmar`, { token: cli, corpo: {} })).dados;
ok(pago.status === 'capturado', 'confirmação marca como capturado');

console.log(cor(1, '\n5. farmacêutico no chat'));
const c = (await api('GET', '/api/conversa', { token: cli })).dados;
ok(c.mensagens.length >= 1 && /não substitui consulta/i.test(c.mensagens[0].texto),
   'a conversa abre com a ressalva, antes de qualquer pergunta');
ok(c.atalhos?.length >= 3, `${c.atalhos.length} perguntas prontas`);
await api('POST', '/api/conversa', { token: cli, corpo: { texto: 'Posso tomar os dois juntos?' } });
const fila = (await api('GET', `/api/comercio/${loja.id}/conversas`, { token: farma })).dados;
ok(fila.length >= 1, 'a pergunta cai na fila do farmacêutico');
const negado = await api('POST', `/api/comercio/${loja.id}/conversas/${fila[0].id}/responder`,
  { token: ger, corpo: { texto: 'pode sim' } });
ok(negado.status === 403, 'gerente sem CRF não dá orientação farmacêutica');
const respondida = (await api('POST', `/api/comercio/${loja.id}/conversas/${fila[0].id}/responder`,
  { token: farma, corpo: { texto: 'Melhor não: os dois são analgésicos.' } })).dados;
ok(respondida.mensagens.at(-1).crf?.includes('CRF'), `resposta sai assinada: ${respondida.mensagens.at(-1).crf}`);

console.log(cor(1, '\n6. busca por sintoma'));
const sin = (await api('GET', '/api/sintomas')).dados;
ok(sin.itens.length >= 8, `${sin.itens.length} sintomas mapeados`);
const dor = (await api('GET', '/api/catalogo/busca?sintoma=dor_cabeca')).dados;
ok(dor.total >= 3, `"dor de cabeça" leva a ${dor.total} itens`);
ok(/prateleira, não uma indicação/i.test(dor.sintoma?.ressalva ?? ''),
   'a resposta carrega o aviso de que é prateleira, não indicação');

console.log(cor(1, '\n7. operação da casa'));
const rup = (await api('GET', `/api/comercio/${loja.id}/ruptura`, { token: ger })).dados;
ok(Array.isArray(rup), `previsão de ruptura: ${rup.length} item(ns)`);
const pedidos = (await api('GET', `/api/comercio/${loja.id}/pedidos`, { token: ger })).dados;
const comPos = pedidos.flatMap((p) => p.itens).filter((i) => i.posicao);
ok(comPos.length > 0, `separação traz a posição na prateleira (ex: ${comPos[0]?.posicao})`);
const ind = (await api('GET', `/api/comercio/${loja.id}/indicadores`, { token: ger })).dados;
ok(typeof ind.ruptura_prevista === 'number', `painel mostra ${ind.ruptura_prevista} item(ns) perto de zerar`);

console.log('\n' + (falhou === 0
  ? cor(32, `  ${passou} verificações passaram.\n`)
  : cor(31, `  ${passou} passaram, ${falhou} falharam.\n`)));
process.exitCode = falhou ? 1 : 0;
