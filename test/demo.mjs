/**
 * Enche a operação com pedidos vivos, para olhar o app e o painel com
 * conteúdo de verdade. Só venda livre, que é o que a Solmedic+ entrega hoje.
 */
const BASE = process.env.SM_API || 'http://localhost:4173';
const api = async (m, c, { token, corpo } = {}) => {
  const r = await fetch(BASE + c, { method: m,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined });
  return r.json().catch(() => ({}));
};
const login = async (e, s) => (await api('POST', '/api/auth/login', { corpo: { email: e, senha: s } })).token;

const cli = await login('cliente@exemplo.com', 'cliente123');
const ger = await login('gerente@solmedic.com.br', 'loja123');
const moto = await login('entregador@solmedic.com.br', 'moto123');
const loja = (await api('GET', '/api/config')).farmacia;
const end = (await api('GET', '/api/enderecos', { token: cli }))[0];

const DIPI = '7896112179245';   // dipirona genérica
const VITC = '7891142199058';   // vitamina C
const BEPA = '7891010023331';   // bepantol
const SORO = '7896112100034';   // soro fisiológico
const FRAL = '7896007545018';   // fralda
const HIDR = '7896512900105';   // hidratante

const pede = (itens) => api('POST', '/api/pedidos', { token: cli,
  corpo: { pharmacy_id: loja.id, address_id: end.id, itens } });

// 1) acabou de cair: o cronômetro de 90s corre no painel
const a = await pede([{ ean: DIPI, qtd: 2 }, { ean: SORO, qtd: 1 }]);

// 2) aceito, e faltou um item — espera a contraproposta
const b = await pede([{ ean: VITC, qtd: 1 }, { ean: FRAL, qtd: 1 }]);
await api('POST', `/api/comercio/${loja.id}/pedidos/${b.id}/aceitar`, { token: ger });
const semEstoque = b.itens.find((i) => i.ean === FRAL);
await api('POST', `/api/comercio/${loja.id}/pedidos/${b.id}/itens/${semEstoque.id}/indisponivel`, { token: ger });
await api('POST', `/api/comercio/${loja.id}/pedidos/${b.id}/itens/${semEstoque.id}/substituir`,
  { token: ger, corpo: { ean: HIDR } });

// 3) a caminho: é o que dá vida ao mapa
const c = await pede([{ ean: BEPA, qtd: 1 }, { ean: DIPI, qtd: 1 }]);
await api('POST', `/api/comercio/${loja.id}/pedidos/${c.id}/aceitar`, { token: ger });
await api('POST', `/api/comercio/${loja.id}/pedidos/${c.id}/pronto`, { token: ger, corpo: {
  conferencia: c.itens.map((i) => ({ item_id: i.id, lote: 'BP4471', validade: '2028-06-30' })) } });
await api('POST', `/api/entregador/entregas/${c.id}/retirar`, { token: moto });

// 4) entregue e sem nota: abre direto na avaliação
const d = await pede([{ ean: VITC, qtd: 2 }, { ean: DIPI, qtd: 1 }]);
await api('POST', `/api/comercio/${loja.id}/pedidos/${d.id}/aceitar`, { token: ger });
await api('POST', `/api/comercio/${loja.id}/pedidos/${d.id}/pronto`, { token: ger, corpo: {
  conferencia: d.itens.map((i) => ({ item_id: i.id,
    lote: { [VITC]: 'VC7712', [DIPI]: 'DP4408' }[i.ean] ?? 'LT0001',
    validade: { [VITC]: '2028-04-30', [DIPI]: '2027-02-28' }[i.ean] ?? '2028-12-31' })) } });
await api('POST', `/api/entregador/entregas/${d.id}/retirar`, { token: moto });
await api('POST', `/api/entregador/entregas/${d.id}/entregar`, { token: moto,
  corpo: { recebido_por: 'Jhony R.' } });

// 5) uma entrega antiga, com um item vencendo já já — enche o armário
const ANTIGO = [{ ean: BEPA, qtd: 1 }, { ean: SORO, qtd: 1 }, { ean: HIDR, qtd: 1 }];
const e = await pede(ANTIGO);
await api('POST', `/api/comercio/${loja.id}/pedidos/${e.id}/aceitar`, { token: ger });
const daquiA = (dias) => new Date(Date.now() + dias * 864e5).toISOString().slice(0, 10);
await api('POST', `/api/comercio/${loja.id}/pedidos/${e.id}/pronto`, { token: ger, corpo: {
  conferencia: e.itens.map((i) => ({ item_id: i.id,
    lote: { [BEPA]: 'BP3391', [SORO]: 'SR1120', [HIDR]: 'HD8802' }[i.ean],
    // o Bepantol vence em 40 dias: é o que dispara o aviso de validade
    validade: { [BEPA]: daquiA(40), [SORO]: daquiA(620), [HIDR]: daquiA(400) }[i.ean] })) } });
await api('POST', `/api/entregador/entregas/${e.id}/retirar`, { token: moto });
await api('POST', `/api/entregador/entregas/${e.id}/entregar`, { token: moto,
  corpo: { recebido_por: 'Jhony R.' } });

console.log(`
  ${a.codigo}  caiu agora, cronômetro correndo no painel
  ${b.codigo}  faltou a fralda, contraproposta esperando o cliente
  ${c.codigo}  a caminho — abra este para ver o mapa
  ${d.codigo}  entregue e sem nota — abre direto na avaliação
  ${e.codigo}  entregue antes — encheu o armário, um item vence em 40 dias
`);
