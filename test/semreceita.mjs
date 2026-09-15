/**
 * A operação de hoje: só medicamento de venda livre.
 * A máquina de receita continua inteira — está desligada, não apagada.
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

console.log(cor(1, '\nSÓ VENDA LIVRE\n'));

const admin = await login('admin@solmedic.app', 'admin123');
const cli = await login('cliente@exemplo.com', 'cliente123');
await api('PUT', '/api/admin/config', { token: admin, corpo: { receita_habilitada: false } });

const cfg = (await api('GET', '/api/config')).dados;
ok(cfg.receita_habilitada === false, 'o interruptor está desligado');
ok(cfg.loja_propria === true, 'loja própria, não marketplace');
ok(cfg.farmacia?.nome?.includes('Solmedic'), `a farmácia é a nossa: ${cfg.farmacia?.nome}`);

const LOSA = '7896004704128';   // tarja vermelha
const DIPI = '7896112179245';   // venda livre

console.log(cor(1, '\n1. catálogo'));
const busca = (await api('GET', '/api/catalogo/busca?q=losartana')).dados;
ok(busca.itens.length === 0, 'tarja vermelha não aparece na busca');

const livre = (await api('GET', '/api/catalogo/busca?q=dipirona')).dados;
ok(livre.itens.length > 0, `venda livre aparece normal (${livre.itens.length} itens)`);
ok(livre.itens.every((i) => !i.requer_receita), 'nenhum resultado exige receita');

const prod = await api('GET', `/api/catalogo/${LOSA}`);
ok(prod.status === 404 && prod.dados.erro === 'FORA_DO_CATALOGO',
   'abrir o produto direto pelo EAN também não passa', prod.dados.mensagem);

console.log(cor(1, '\n2. carrinho'));
const cfgLoja = cfg.farmacia.id;
const orcRx = await api('POST', '/api/carrinho/orcamento', {
  token: cli, corpo: { pharmacy_id: cfgLoja, itens: [{ ean: LOSA, qtd: 1 }] } });
ok(orcRx.status === 422 && orcRx.dados.erro === 'RECEITA_DESABILITADA',
   'orçamento recusa item com receita', orcRx.dados.mensagem);

const orcOk = (await api('POST', '/api/carrinho/orcamento', {
  token: cli, corpo: { pharmacy_id: cfgLoja, itens: [{ ean: DIPI, qtd: 2 }] } })).dados;
ok(orcOk.exige_receita === false, 'carrinho de venda livre não exige receita');
ok(orcOk.grupos.aguarda_farmaceutico.length === 0, 'e não tem grupo esperando farmacêutico');

console.log(cor(1, '\n3. a home reflete a operação'));
const inicio = (await api('GET', '/api/inicio', { token: cli })).dados;
ok(inicio.receita_habilitada === false, 'a home sabe que receita está desligada');
ok(inicio.continuos.length === 0, 'não oferece "continuar tratamento" sem receita');
ok(inicio.ofertas.every((o) => !o.requer_receita), 'nenhuma oferta com tarja');
ok(!!inicio.area?.length, `área atendida declarada: ${inicio.area.join(', ')}`);

console.log(cor(1, '\n4. o interruptor liga de volta'));
const ligado = (await api('PUT', '/api/admin/config', {
  token: admin, corpo: { receita_habilitada: true } })).dados;
ok(ligado.receita_habilitada === true, 'admin liga sem reiniciar nada');
const voltou = (await api('GET', '/api/catalogo/busca?q=losartana')).dados;
ok(voltou.itens.length > 0, 'e a tarja vermelha volta ao catálogo na hora');

const negado = await api('PUT', '/api/admin/config', { token: cli, corpo: { receita_habilitada: false } });
ok(negado.status === 403, 'cliente não mexe no interruptor');

await api('PUT', '/api/admin/config', { token: admin, corpo: { receita_habilitada: false } });

console.log('\n' + (falhou === 0
  ? cor(32, `  ${passou} verificações passaram. A operação de venda livre está fechada.\n`)
  : cor(31, `  ${passou} passaram, ${falhou} falharam.\n`)));
process.exitCode = falhou ? 1 : 0;
