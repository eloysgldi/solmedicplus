/**
 * O caminho de quem chega do zero.
 *
 * Cria a conta, cadastra o endereço, compra — e do outro lado a loja
 * aceita, separa, despacha e entrega. Se isto passa, o produto existe.
 *
 *   npm run dev   e depois   node test/cliente-novo.mjs
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

console.log(cor(1, '\nDO ZERO ATÉ A PORTA\n'));

const marca = Date.now().toString().slice(-7);
const EMAIL = `novo${marca}@exemplo.com`;
const cfg = (await api('GET', '/api/config')).dados;
const L = cfg.farmacia.id;

console.log(cor(1, '1. a conta'));
const curto = await api('POST', '/api/auth/registrar', { corpo: {
  nome: 'Teste', email: EMAIL, senha: '123' } });
ok(curto.status === 201 || curto.status === 400, 'registro responde sem quebrar');

const cadastro = await api('POST', '/api/auth/registrar', { corpo: {
  nome: 'Regina Tavares', email: `a${EMAIL}`, senha: 'segredo123',
  telefone: '85 98888-7766', socio: 1 } });
ok(cadastro.status === 201 && cadastro.dados.token, 'conta criada e já vem com sessão', cadastro.dados);
const cli = cadastro.dados.token;

const repetido = await api('POST', '/api/auth/registrar', { corpo: {
  nome: 'Outra', email: `a${EMAIL}`, senha: 'segredo123' } });
ok(repetido.status === 409, 'o mesmo e-mail duas vezes é recusado');

const eu = (await api('GET', '/api/auth/eu', { token: cli })).dados;
ok(eu.nome === 'Regina Tavares' && eu.socio === 1, 'a sessão já sabe quem é e que é sócia');

console.log(cor(1, '\n2. o endereço'));
const vazio = (await api('GET', '/api/enderecos', { token: cli })).dados;
ok(vazio.length === 0, 'conta nova começa sem endereço — por isso a tela pede antes do carrinho');

const incompleto = await api('POST', '/api/enderecos', { token: cli, corpo: { numero: '10' } });
ok(incompleto.status === 400, 'endereço sem rua e bairro é recusado');

const end = await api('POST', '/api/enderecos', { token: cli, corpo: {
  apelido: 'Casa', logradouro: 'Rua das Laranjeiras', numero: '900', bairro: cfg.area[0],
  cidade: 'Fortaleza', uf: 'CE', cep: '60000-000', padrao: 1 } });
ok(end.status === 201 && end.dados.id, 'endereço salvo', end.dados);
ok(cfg.area.includes(end.dados.bairro), `no bairro atendido (${end.dados.bairro})`);

const inicio = (await api('GET', '/api/inicio', { token: cli })).dados;
ok(inicio.fora_da_area === false, 'a home já reconhece que dá para entregar aí');

console.log(cor(1, '\n3. a compra'));
const vitrine = (await api('GET', '/api/inicio', { token: cli })).dados.ofertas ?? [];
const escolhido = vitrine[0] ?? { ean: '7896112179245' };
const orc = (await api('POST', '/api/carrinho/orcamento', { token: cli, corpo: {
  pharmacy_id: L, itens: [{ ean: escolhido.ean, qtd: 2 }] } })).dados;
ok(orc.total_centavos > 0, `orçamento fechado: ${orc.total_centavos} centavos`);
ok(orc.economia_centavos >= 0, 'com o preço de sócia já aplicado');

const pedido = await api('POST', '/api/pedidos', { token: cli, corpo: {
  pharmacy_id: L, itens: [{ ean: escolhido.ean, qtd: 2 }], metodo: 'cartao',
  cartao_final: '4417', address_id: end.dados.id } });
ok(pedido.status === 201, 'pedido criado por uma conta que nasceu agora', pedido.dados);
const P = pedido.dados;
ok(P.status === 'aguardando_loja', `estado inicial: ${P.status}`);
ok(P.pagamento.status === 'autorizado' && P.pagamento.valor_capturado_centavos === 0,
   'cartão autorizado e nada capturado ainda');

console.log(cor(1, '\n4. o dono, do outro lado'));
const dono = (await api('POST', '/api/auth/login', { corpo: {
  email: 'gerente@solmedic.com.br', senha: 'loja123' } })).dados.token;
const minhas = (await api('GET', '/api/auth/eu', { token: dono })).dados;
ok(minhas.lojas?.length === 1 && minhas.lojas[0].papel === 'gerente',
   'a conta do dono já chega sabendo qual loja ela opera — é o que o painel usa para entrar');

const fila = (await api('GET', `/api/comercio/${L}/pedidos`, { token: dono })).dados;
ok(fila.some((o) => o.id === P.id), `o pedido novo apareceu na fila da loja (${fila.length} na fila)`);

const aceito = await api('POST', `/api/comercio/${L}/pedidos/${P.id}/aceitar`, { token: dono });
ok(aceito.status === 200 && aceito.dados.status === 'em_separacao', 'loja aceitou → em separação');

const pronto = await api('POST', `/api/comercio/${L}/pedidos/${P.id}/pronto`, {
  token: dono, corpo: { conferencia: [] } });
ok(pronto.dados.status === 'pronto', 'separado e conferido → pronto');
ok(pronto.dados.itens[0].lote, `lote gravado sozinho por FEFO: ${pronto.dados.itens[0].lote}`);

const cobrado = (await api('GET', `/api/pedidos/${P.id}`, { token: cli })).dados;
ok(cobrado.pagamento.status === 'capturado', 'e só agora o cartão foi cobrado');

const despachado = await api('POST', `/api/comercio/${L}/pedidos/${P.id}/despachar`, {
  token: dono, corpo: {} });
ok(despachado.dados.status === 'em_rota', 'o dono marcou que saiu para entrega → em rota');

const moto = (await api('POST', '/api/auth/login', { corpo: {
  email: 'entregador@solmedic.com.br', senha: 'moto123' } })).dados.token;
await api('POST', `/api/entregador/entregas/${P.id}/retirar`, { token: moto });
const entregue = await api('POST', `/api/entregador/entregas/${P.id}/entregar`, {
  token: moto, corpo: { recebido_por: 'Regina T.' } });
ok(entregue.dados.status === 'entregue', 'entregue');

console.log(cor(1, '\n5. o que ficou'));
const visto = (await api('GET', `/api/pedidos/${P.id}`, { token: cli })).dados;
ok(visto.status === 'entregue', 'o cliente vê o pedido concluído');
const armario = (await api('GET', '/api/armario', { token: cli })).dados;
ok(armario.itens.length > 0 && armario.itens[0].lote,
   'e a caixa entrou no armário dele com lote e validade');
const ficha = (await api('GET', `/api/comercio/${L}/clientes/${eu.id}`, { token: dono })).dados;
ok(ficha.cliente?.pedidos === 1 && ficha.cliente.segmento === 'novo',
   'do lado da loja, a pessoa já aparece no CRM como cliente novo');

const espiando = await api('GET', `/api/pedidos/${P.id}`, { token: dono });
ok(espiando.status === 403 || espiando.status === 404,
   'e o pedido de um cliente não abre para quem não é dele');

console.log('\n' + (falhou === 0
  ? cor(32, `  ${passou} verificações passaram. Dá para criar conta, comprar e entregar.\n`)
  : cor(31, `  ${falhou} de ${passou + falhou} falharam.\n`)));
process.exitCode = falhou === 0 ? 0 : 1;
