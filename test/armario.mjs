/**
 * O armário da casa e o recolhimento de lote.
 *
 * É o diferencial da plataforma, então é o que mais precisa de teste:
 * lote entra na entrega, o carrinho para de empurrar o que a pessoa já
 * tem, e quando um lote é recolhido quem levou aquele lote é avisado
 * pelo nome — não um comunicado genérico no mural.
 *
 *   npm run dev   e depois   node test/armario.mjs
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
const emDias = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

console.log(cor(1, '\nO ARMÁRIO E O RECALL\n'));

const cli = await login('cliente@exemplo.com', 'cliente123');
const ger = await login('gerente@solmedic.com.br', 'loja123');
const moto = await login('entregador@solmedic.com.br', 'moto123');
const admin = await login('admin@solmedic.app', 'admin123');
const loja = (await api('GET', '/api/config')).dados.farmacia;
const end = (await api('GET', '/api/enderecos', { token: cli })).dados[0];

const VITC = '7891142199058';   // vai ser recolhido
const ENO  = '7891317009083';   // fica no armário, para provar que o recall não pega geral
const BEPA = '7891010023331';   // entra perto de vencer

/** Leva um carrinho do zero até "entregue", gravando lote e validade. */
async function entrega(itens, conferir) {
  const pedido = (await api('POST', '/api/pedidos', { token: cli, corpo: {
    pharmacy_id: loja.id, itens, metodo: 'cartao', cartao_final: '4417', address_id: end.id } })).dados;
  await api('POST', `/api/comercio/${loja.id}/pedidos/${pedido.id}/aceitar`, { token: ger });
  const atual = (await api('GET', `/api/pedidos/${pedido.id}`, { token: cli })).dados;
  const sep = await api('POST', `/api/comercio/${loja.id}/pedidos/${pedido.id}/pronto`, { token: ger, corpo: {
    conferencia: atual.itens.filter((i) => i.status !== 'indisponivel').map((i) => conferir(i)) } });
  if (sep.status >= 400) console.log(cor(90, '     separação: ' + JSON.stringify(sep.dados)));
  await api('POST', `/api/entregador/entregas/${pedido.id}/retirar`, { token: moto });
  const fim = await api('POST', `/api/entregador/entregas/${pedido.id}/entregar`, {
    token: moto, corpo: { recebido_por: 'Jhony R.', documento: '***.456.789-**' } });
  return { pedido, fim };
}

// ---------- 1. a entrega abastece o armário ----------
console.log(cor(1, '1. o que foi entregue entra no armário'));
const LOTE = 'SM' + Date.now().toString().slice(-6);
const { pedido, fim } = await entrega(
  [{ ean: VITC, qtd: 2 }, { ean: ENO, qtd: 1 }],
  (i) => ({ item_id: i.id, lote: i.ean === VITC ? LOTE : 'ENO-77',
            validade: i.ean === VITC ? emDias(30) : emDias(400) }));
ok(fim.dados.status === 'entregue', 'pedido entregue', fim.dados);

const arm1 = (await api('GET', '/api/armario', { token: cli })).dados;
const vitc = arm1.itens.find((i) => i.ean === VITC && i.lote === LOTE);
const eno = arm1.itens.find((i) => i.ean === ENO && i.order_id === pedido.id);
ok(!!vitc, `a caixa entregue está no armário com o lote ${LOTE}`);
ok(vitc?.qtd_atual === 2, 'com a quantidade que saiu da loja');
ok(vitc?.estado === 'vencendo' && vitc.dias_para_vencer <= 60,
   `marcada como vencendo (${vitc?.dias_para_vencer} dias)`, { estado: vitc?.estado });
ok(eno?.estado === 'ok', 'o que vence longe fica quieto');
ok(arm1.resumo.total >= 2 && arm1.resumo.vencendo >= 1, 'resumo bate com os itens', arm1.resumo);
ok(arm1.itens.filter((i) => i.order_id === pedido.id).length === 2,
   'um item de armário por item do pedido, sem duplicar');

// ---------- 2. o carrinho para de empurrar o que já tem em casa ----------
console.log(cor(1, '\n2. "você já tem isso em casa"'));
const orc = (await api('POST', '/api/carrinho/orcamento', { token: cli, corpo: {
  pharmacy_id: loja.id, itens: [{ ean: VITC, qtd: 1 }] } })).dados;
ok(orc.ja_tem?.some((i) => i.ean === VITC), 'o orçamento avisa que a pessoa já tem em casa', orc.ja_tem);
ok(orc.ja_tem.find((i) => i.ean === VITC)?.qtd === 2, 'e diz quantas ainda restam');

const semDono = (await api('POST', '/api/carrinho/orcamento', { corpo: {
  pharmacy_id: loja.id, itens: [{ ean: VITC, qtd: 1 }] } })).dados;
ok(Array.isArray(semDono.ja_tem) && semDono.ja_tem.length === 0,
   'visitante sem conta não recebe armário de ninguém');

// ---------- 3. a pessoa ajusta o que sobrou ----------
console.log(cor(1, '\n3. a pessoa mexe no próprio armário'));
const ajustado = (await api('PUT', `/api/armario/${eno.id}`, {
  token: cli, corpo: { qtd_atual: 1 } })).dados;
ok(ajustado.qtd_atual === 1, 'dá para corrigir a quantidade');

const alheio = await api('PUT', `/api/armario/${eno.id}`, { token: ger, corpo: { qtd_atual: 0 } });
ok(alheio.status === 404, 'ninguém mexe no armário do outro', alheio.dados);

const zerado = (await api('PUT', `/api/armario/${eno.id}`, {
  token: cli, corpo: { qtd_atual: 0 } })).dados;
ok(!!zerado.encerrado_em && zerado.motivo === 'acabou', 'zerar encerra o item como "acabou"');
const arm2 = (await api('GET', '/api/armario', { token: cli })).dados;
ok(!arm2.itens.some((i) => i.id === eno.id), 'e ele some da lista do dia a dia');
const arm2t = (await api('GET', '/api/armario?tudo=1', { token: cli })).dados;
ok(arm2t.itens.some((i) => i.id === eno.id), 'mas continua no histórico');

// ---------- 4. o recolhimento ----------
console.log(cor(1, '\n4. recolhimento de lote'));
const antes = (await api('GET', `/api/comercio/${loja.id}/catalogo?q=Vitamina C`, { token: ger }))
  .dados.find((i) => i.ean === VITC);

const doCliente = await api('POST', `/api/comercio/${loja.id}/recalls`, { token: cli, corpo: {
  ean: VITC, lote: LOTE, motivo: 'teste indevido' } });
ok(doCliente.status === 403, 'cliente não recolhe lote nenhum', doCliente.dados);

const semMotivo = await api('POST', `/api/comercio/${loja.id}/recalls`, { token: ger, corpo: {
  ean: VITC, lote: LOTE, motivo: 'oi' } });
ok(semMotivo.status === 422 && semMotivo.dados.erro === 'MOTIVO_OBRIGATORIO',
   'sem motivo escrito não sai recall — é o texto que o cliente vai ler', semMotivo.dados);

const fantasma = await api('POST', `/api/comercio/${loja.id}/recalls`, { token: ger, corpo: {
  ean: '0000000000000', motivo: 'produto que não existe no catálogo' } });
ok(fantasma.status === 404, 'EAN fora do catálogo é recusado');

const rec = await api('POST', `/api/comercio/${loja.id}/recalls`, { token: ger, corpo: {
  ean: VITC, lote: LOTE, origem: 'anvisa', referencia: 'RE 2.104/2026',
  motivo: 'Desvio de qualidade: comprimidos com manchas escuras' } });
ok(rec.status === 201, 'recolhimento registrado', rec.dados);
ok(rec.dados.atingidos >= 1, `${rec.dados.atingidos} cliente(s) atingido(s) — não é cartaz no mural`);
ok(rec.dados.avisados.some((a) => a.cliente === 'Jhony R.' && a.lote === LOTE),
   'a loja vê pelo nome quem levou aquele lote', rec.dados.avisados);

// ---------- 5. o que acontece do lado de quem levou ----------
console.log(cor(1, '\n5. do lado de quem levou'));
const arm3 = (await api('GET', '/api/armario?tudo=1', { token: cli })).dados;
const depois = arm3.itens.find((i) => i.id === vitc.id);
ok(depois?.estado === 'recolhido', 'a caixa aparece como recolhida, não como "acabou"');
ok(depois?.motivo === 'recolhido' && !!depois.encerrado_em, 'e sai do uso na hora');

const avisos = (await api('GET', '/api/notificacoes', { token: cli })).dados;
const aviso = (avisos.itens ?? avisos).find((n) => n.tipo === 'recall');
ok(!!aviso, 'o cliente foi notificado');
ok(!!aviso?.titulo.includes('pare de usar'), `título direto: "${aviso?.titulo}"`);
ok(aviso?.url === '/#armario', 'e o toque leva direto para o armário');
ok(!aviso?.corpo.includes('Vitamina C'),
   'o nome do remédio não vai na tela de bloqueio sem a pessoa pedir');

const orcDepois = (await api('POST', '/api/carrinho/orcamento', { token: cli, corpo: {
  pharmacy_id: loja.id, itens: [{ ean: ENO, qtd: 1 }] } })).dados;
ok(!orcDepois.ja_tem?.some((i) => i.ean === VITC), 'item recolhido não conta como "já tem em casa"');

const vitrine = (await api('GET', '/api/catalogo/busca?q=Vitamina%20C%201%20g')).dados;
ok(!vitrine.itens.some((i) => i.ean === VITC), 'o produto sai da vitrine enquanto o lote está recolhido');

// a notificação manda a pessoa para o armário, então a caixa recolhida
// precisa estar lá quando ela chegar — não sumir junto com o encerramento
const armAtivo = (await api('GET', '/api/armario', { token: cli })).dados;
ok(armAtivo.itens.some((i) => i.id === vitc.id && i.estado === 'recolhido'),
   'a caixa recolhida continua visível no armário, em "precisa de ação"');
ok(armAtivo.resumo.recolhidos >= 1, 'e o resumo acende o aviso na home', armAtivo.resumo);

const resolvido = (await api('PUT', `/api/armario/${vitc.id}`, {
  token: cli, corpo: { encerrar: true, motivo: 'descartado' } })).dados;
ok(resolvido.motivo === 'descartado', 'quando a pessoa devolve a caixa, ela some da lista');
const armLimpo = (await api('GET', '/api/armario', { token: cli })).dados;
ok(!armLimpo.itens.some((i) => i.id === vitc.id), 'e não fica cutucando depois de resolvida');
const lista = (await api('GET', `/api/comercio/${loja.id}/recalls`, { token: ger })).dados;
ok(lista[0]?.id === rec.dados.id && !!lista[0].produto, 'o histórico de recolhimentos fica no painel');

// ---------- 6. aviso de validade ----------
console.log(cor(1, '\n6. o remédio que vence'));
const nada = await api('POST', '/api/admin/vencimentos', { token: cli });
ok(nada.status === 403, 'varredura de validade é da casa, não do cliente');

// uma caixa nova, perto de vencer, que ninguém recolheu
await entrega([{ ean: BEPA, qtd: 1 }],
  (i) => ({ item_id: i.id, lote: 'BP' + LOTE.slice(-4), validade: emDias(20) }));
const varr1 = (await api('POST', '/api/admin/vencimentos', { token: admin })).dados;
ok(varr1.avisados >= 1, `varredura avisou ${varr1.avisados} item(ns) perto de vencer`);
const caixaAvisos = (await api('GET', '/api/notificacoes', { token: cli })).dados;
const venc = (caixaAvisos.itens ?? caixaAvisos).find((n) => n.tipo === 'vencendo');
ok(!!venc && venc.url === '/#armario', `aviso de validade chegou: "${venc?.titulo}"`);
ok(!venc?.corpo.includes('Bepantol'), 'e também sem o nome do produto na tela de bloqueio');
const varr2 = (await api('POST', '/api/admin/vencimentos', { token: admin })).dados;
ok(varr2.avisados === 0, 'rodar de novo não repete o mesmo alerta na cara da pessoa');

// devolve o produto para a prateleira: teste não pode deixar o catálogo capenga
if (antes) {
  await api('POST', `/api/comercio/${loja.id}/catalogo`, { token: ger, corpo: {
    ean: VITC, preco_centavos: antes.preco_centavos,
    preco_socio_centavos: antes.preco_socio_centavos, estoque: antes.estoque, ativo: 1 } });
  const voltou = (await api('GET', '/api/catalogo/busca?q=Vitamina%20C%201%20g')).dados;
  ok(voltou.itens.some((i) => i.ean === VITC), 'a loja devolve o produto à vitrine quando o lote é liberado');
}

console.log('\n' + (falhou === 0
  ? cor(32, `  ${passou} verificações passaram. O armário segura o lote do começo ao fim.\n`)
  : cor(31, `  ${falhou} de ${passou + falhou} falharam.\n`)));
process.exitCode = falhou === 0 ? 0 : 1;
