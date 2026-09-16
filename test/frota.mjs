/**
 * A plataforma conversando entre si.
 *
 * Loja cadastra o piloto e liga o rastreio; o piloto entra em turno,
 * pega a corrida e transmite posição; o cliente vê a moto; a loja recebe
 * o aviso de que saiu e de que chegou. Se um elo desses quebrar, o resto
 * continua parecendo certo — por isso o teste é de ponta a ponta.
 *
 *   npm run dev   e depois   node test/frota.mjs
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

console.log(cor(1, '\nA FROTA, DE PONTA A PONTA\n'));

const ger = await login('gerente@solmedic.com.br', 'loja123');
const cli = await login('cliente@exemplo.com', 'cliente123');
const loja = (await api('GET', '/api/config')).dados.farmacia;
const L = loja.id;
const end = (await api('GET', '/api/enderecos', { token: cli })).dados[0];

// ---------- 1. a loja cadastra ----------
console.log(cor(1, '1. a loja cadastra o piloto'));
const marca = Date.now().toString().slice(-6);
const NOME = `Rosana Prado ${marca}`;
const semNome = await api('POST', `/api/comercio/${L}/entregadores`, { token: ger, corpo: {
  nome: '', veiculo: 'moto', placa: 'AAA1A11' } });
ok(semNome.status === 422, 'piloto sem nome é recusado');

const semPlaca = await api('POST', `/api/comercio/${L}/entregadores`, { token: ger, corpo: {
  nome: 'Teste Moto', veiculo: 'moto' } });
ok(semPlaca.status === 422 && semPlaca.dados.erro === 'PLACA_OBRIGATORIA',
   'moto sem placa não sai para entrega', semPlaca.dados);

const novo = await api('POST', `/api/comercio/${L}/entregadores`, { token: ger, corpo: {
  nome: NOME, telefone: '85 98111-2233', veiculo: 'moto', placa: `RPS-${marca.slice(0, 4)}`,
  email: `rosana${marca}@exemplo.com`, senha: 'entrega123',
  caixa_termica: true, rastreavel: true } });
ok(novo.status === 201, 'piloto cadastrado', novo.dados);
ok(novo.dados.user_id, 'e a conta de acesso nasce junto — ninguém espera alguém "abrir o login"');
ok(novo.dados.rastreavel === 1, 'com rastreamento ligado pela loja');

const bike = await api('POST', `/api/comercio/${L}/entregadores`, { token: ger, corpo: {
  nome: 'Pedro Bike', veiculo: 'bike' } });
ok(bike.status === 201, 'bicicleta não precisa de placa');

const deFora = await api('POST', `/api/comercio/${L}/entregadores`, { token: cli, corpo: {
  nome: 'Intruso', veiculo: 'bike' } });
ok(deFora.status === 403, 'cliente não cadastra entregador');

// ---------- 2. o piloto entra em turno ----------
console.log(cor(1, '\n2. o turno'));
const piloto = await login(`rosana${marca}@exemplo.com`, 'entrega123');
const eu = (await api('GET', '/api/entregador/eu', { token: piloto })).dados;
ok(eu.nome === NOME && eu.pharmacy_id === L, 'o app dela já sabe de qual farmácia é');

const foraDeTurno = await api('POST', '/api/entregador/posicao', { token: piloto, corpo: {
  lat: -3.73, lng: -38.52, precisao_m: 10 } });
ok(foraDeTurno.dados.gravado === false,
   'fora de turno nenhuma posição é gravada, mesmo o app mandando', foraDeTurno.dados);

await api('POST', '/api/entregador/turno', { token: piloto, corpo: { entrando: true } });
const pos1 = await api('POST', '/api/entregador/posicao', { token: piloto, corpo: {
  lat: -3.7300, lng: -38.5250, precisao_m: 12, velocidade: 8, rumo: 130 } });
ok(pos1.dados.gravado === true, 'em turno, a posição entra');

const ruim = await api('POST', '/api/entregador/posicao', { token: piloto, corpo: {
  lat: -3.7300, lng: -38.5250, precisao_m: 800 } });
ok(ruim.dados.gravado === false && ruim.dados.motivo.includes('precisão'),
   'ponto com 800 m de erro é descartado — senão a moto teleporta no mapa do cliente');

const naRua = (await api('GET', `/api/comercio/${L}/frota/posicoes`, { token: ger })).dados;
ok(naRua.some((c) => c.nome === NOME), 'a loja vê a moto dela na rua');

const cliente = await api('GET', `/api/comercio/${L}/frota/posicoes`, { token: cli });
ok(cliente.status === 403, 'e ninguém de fora vê onde os entregadores estão');

// ---------- 3. o rastreio é decisão da loja ----------
console.log(cor(1, '\n3. a loja manda no rastreamento'));
await api('POST', `/api/comercio/${L}/entregadores`, { token: ger, corpo: {
  ...novo.dados, rastreavel: false } });
const mudo = await api('POST', '/api/entregador/posicao', { token: piloto, corpo: {
  lat: -3.7311, lng: -38.5261, precisao_m: 10 } });
ok(mudo.dados.gravado === false,
   'rastreio desligado: o app pode mandar, o servidor descarta', mudo.dados);
const sumiu = (await api('GET', `/api/comercio/${L}/frota/posicoes`, { token: ger })).dados;
ok(!sumiu.some((c) => c.nome === NOME), 'e ela some do mapa da loja na hora');

await api('POST', `/api/comercio/${L}/entregadores`, { token: ger, corpo: {
  ...novo.dados, rastreavel: true } });
await api('POST', '/api/entregador/posicao', { token: piloto, corpo: {
  lat: -3.7305, lng: -38.5255, precisao_m: 10, velocidade: 7 } });
ok(true, 'religado, a posição volta a entrar');

// ---------- 4. a corrida inteira ----------
console.log(cor(1, '\n4. do balcão até a porta'));
const pedido = (await api('POST', '/api/pedidos', { token: cli, corpo: {
  pharmacy_id: L, itens: [{ ean: '7896112179245', qtd: 1 }], metodo: 'cartao',
  cartao_final: '4417', address_id: end.id } })).dados;
await api('POST', `/api/comercio/${L}/pedidos/${pedido.id}/aceitar`, { token: ger });
await api('POST', `/api/comercio/${L}/pedidos/${pedido.id}/pronto`, {
  token: ger, corpo: { conferencia: [] } });

const fila = (await api('GET', '/api/entregador/fila', { token: piloto })).dados;
ok(fila.disponiveis.some((c) => c.id === pedido.id),
   'o pedido pronto aparece no balcão para quem está em turno');
ok(fila.loja?.lat, 'e a fila já traz onde fica a loja, para traçar a rota');
const noBalcao = fila.disponiveis.find((c) => c.id === pedido.id);
ok(noBalcao.lat && noBalcao.lng, 'com a coordenada do endereço de entrega');
ok(noBalcao.cliente && noBalcao.itens > 0, `${noBalcao.itens} item(ns) para ${noBalcao.cliente}`);

const alerta = (await api('GET', `/api/comercio/${L}/alertas`, { token: ger })).dados;
ok(alerta.prontos >= 1 && alerta.entregadores_em_turno >= 1,
   `alerta da operação: ${alerta.prontos} pronto(s), ${alerta.entregadores_em_turno} em turno`);
ok(alerta.sem_entregador === false, 'e não acusa "ninguém na rua" quando tem gente na rua');

await api('POST', `/api/entregador/entregas/${pedido.id}/retirar`, { token: piloto });
const minhas = (await api('GET', '/api/entregador/fila', { token: piloto })).dados;
ok(minhas.minhas.some((c) => c.id === pedido.id), 'depois de pegar, a corrida é dela');
ok(!minhas.disponiveis.some((c) => c.id === pedido.id), 'e sai do balcão para os outros');

const avisosLoja = (await api('GET', '/api/notificacoes', { token: ger })).dados;
const saiu = (avisosLoja.itens ?? avisosLoja).find((n) => n.tipo === 'corrida_aceita');
ok(!!saiu, `a loja foi avisada: "${saiu?.corpo ?? ''}"`);

await api('POST', '/api/entregador/posicao', { token: piloto, corpo: {
  lat: -3.7370, lng: -38.5180, precisao_m: 8, velocidade: 9, rumo: 140 } });
const moto = (await api('GET', `/api/pedidos/${pedido.id}/entregador`, { token: cli })).dados;
ok(moto.lat === -3.7370 && moto.nome === NOME,
   'o cliente vê a moto na posição real, com o nome de quem está levando');

const deOutro = await api('GET', `/api/pedidos/${pedido.id}/entregador`, { token: ger });
ok(deOutro.status === 403, 'e o pedido de um cliente não abre para quem não é dele');

await api('POST', `/api/entregador/entregas/${pedido.id}/entregar`, {
  token: piloto, corpo: { recebido_por: 'Jhony R.' } });
const fim = (await api('GET', `/api/pedidos/${pedido.id}`, { token: cli })).dados;
ok(fim.status === 'entregue', 'entregue');

const depois = (await api('GET', '/api/notificacoes', { token: ger })).dados;
const chegou = (depois.itens ?? depois).find((n) => n.tipo === 'entrega_concluida');
ok(!!chegou, `e a loja soube na hora: "${chegou?.titulo ?? ''}"`);
ok(chegou?.corpo?.includes('Rosana'), 'com o nome de quem entregou', chegou?.corpo);

// ---------- 5. sair do turno apaga o rastro ----------
console.log(cor(1, '\n5. fim de expediente'));
await api('POST', '/api/entregador/turno', { token: piloto, corpo: { entrando: false } });
const vazio = (await api('GET', `/api/comercio/${L}/frota/posicoes`, { token: ger })).dados;
ok(!vazio.some((c) => c.nome === NOME),
   'fora do turno, a última posição é apagada — a loja não acompanha ninguém depois do expediente');

console.log('\n' + (falhou === 0
  ? cor(32, `  ${passou} verificações passaram. Os três lados conversam.\n`)
  : cor(31, `  ${falhou} de ${passou + falhou} falharam.\n`)));
process.exitCode = falhou === 0 ? 0 : 1;
