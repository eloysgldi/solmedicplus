/**
 * Caminha o pedido inteiro pela API, como se fossem cinco pessoas diferentes.
 * Roda com o servidor no ar:  npm run dev   e depois   npm test
 */
const BASE = process.env.CV_API || 'http://localhost:4173';
let passou = 0, falhou = 0;

const cor = (c, t) => `\x1b[${c}m${t}\x1b[0m`;
function ok(cond, msg, extra) {
  if (cond) { passou++; console.log(cor(32, '  ✓'), msg); }
  else { falhou++; console.log(cor(31, '  ✗'), msg, extra ? cor(90, JSON.stringify(extra)) : ''); }
}
const brl = (c) => 'R$ ' + (c / 100).toFixed(2).replace('.', ',');

async function api(metodo, caminho, { token, corpo } = {}) {
  const res = await fetch(BASE + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const txt = await res.text();
  let dados; try { dados = JSON.parse(txt); } catch { dados = txt; }
  return { status: res.status, dados };
}
const login = async (email, senha) => (await api('POST', '/api/auth/login', { corpo: { email, senha } })).dados.token;

console.log(cor(1, '\nSOLMEDIC+ — fluxo ponta a ponta\n'));

// ---------- quem é quem ----------
const tCliente = await login('cliente@exemplo.com', 'cliente123');
const tGerente = await login('gerente@solmedic.com.br', 'loja123');
const tFarma   = await login('farmaceutica@solmedic.com.br', 'crf123');
const tMoto    = await login('entregador@solmedic.com.br', 'moto123');
const tAdmin   = await login('admin@solmedic.app', 'admin123');
ok(tCliente && tGerente && tFarma && tMoto && tAdmin, 'cinco papéis autenticados');

// a máquina de receita é testada ligada; a operação real começa desligada
await api('PUT', '/api/admin/config', { token: await login('admin@solmedic.app', 'admin123'),
  corpo: { receita_habilitada: true } });

const lojas = (await api('GET', '/api/farmacias')).dados;
const loja = lojas.find((l) => l.nome_fantasia.includes('Solmedic'));
ok(!!loja, 'farmácia ativa encontrada', lojas);

const eu = (await api('GET', '/api/auth/eu', { token: tCliente })).dados;
const endereco = (await api('GET', '/api/pedidos', { token: tCliente })).status === 200;
ok(endereco, 'cliente logado consegue ler os próprios pedidos');

// ---------- 1. busca entende princípio ativo ----------
console.log(cor(1, '\n1. busca'));
const busca = (await api('GET', '/api/catalogo/busca?q=dipirona')).dados;
ok(busca.itens.length >= 2, `busca por "dipirona" traz ${busca.itens?.length} itens`);
ok(busca.itens[0].generico === 1, 'genérico aparece primeiro');
const marca = busca.itens.find((i) => i.nome.includes('Novalgina'));
ok(marca?.generico_equivalente, 'a marca mostra o genérico equivalente');
ok(marca?.economia_centavos > 0, `economia calculada: ${brl(marca?.economia_centavos ?? 0)}`);

// ---------- 2. controlado é barrado na porta ----------
console.log(cor(1, '\n2. barreiras regulatórias'));
const ctrl = await api('POST', '/api/carrinho/orcamento', {
  token: tCliente, corpo: { pharmacy_id: loja.id, itens: [{ ean: '7896006210016', qtd: 1 }] } });
ok(ctrl.status === 422 && ctrl.dados.erro === 'CONTROLADO_FORA_DA_PLATAFORMA',
   'clonazepam (Portaria 344) é recusado no orçamento', ctrl.dados);

const semEstoque = await api('POST', '/api/carrinho/orcamento', {
  token: tCliente, corpo: { pharmacy_id: loja.id, itens: [{ ean: '7898422746612', qtd: 1 }] } });
ok(semEstoque.dados.grupos?.sai_agora?.[0]?.em_falta === true, 'protetor sem estoque vem marcado em falta');

// ---------- 3. carrinho dividido ----------
console.log(cor(1, '\n3. carrinho misto'));
const carrinho = [
  { ean: '7896004704128', qtd: 1 },   // Losartana — tarja vermelha
  { ean: '7896112100034', qtd: 2 },   // Soro — venda livre
  { ean: '7896094206489', qtd: 1 },   // Vitamina D — venda livre
];
const orc = (await api('POST', '/api/carrinho/orcamento', {
  token: tCliente, corpo: { pharmacy_id: loja.id, itens: carrinho } })).dados;
ok(orc.grupos.sai_agora.length === 2, 'dois itens saem agora');
ok(orc.grupos.aguarda_farmaceutico.length === 1, 'um item espera o farmacêutico');
ok(orc.exige_entrega_em_maos === true, 'pedido com receita exige entrega em mãos');
ok(orc.economia_centavos > 0, `preço sócio economizou ${brl(orc.economia_centavos)}`);
console.log(cor(90, `     subtotal ${brl(orc.subtotal_centavos)} · frete ${brl(orc.frete_centavos)} · total ${brl(orc.total_centavos)}`));

// ---------- 4. pedido: autoriza, não cobra ----------
console.log(cor(1, '\n4. pedido criado'));
const meuEndereco = (await api('GET', '/api/enderecos', { token: tCliente })).dados[0];
const criado = await api('POST', '/api/pedidos', { token: tCliente, corpo: {
  pharmacy_id: loja.id, itens: carrinho, metodo: 'cartao', cartao_final: '4417',
  address_id: meuEndereco.id,
} });
const pedido = criado.dados;
ok(criado.status === 201, 'pedido criado', criado.dados);
ok(pedido.status === 'aguardando_loja', `estado: ${pedido.status}`);
ok(pedido.pagamento.status === 'autorizado', 'cartão AUTORIZADO, não cobrado');
ok(pedido.pagamento.valor_capturado_centavos === 0, 'nada capturado ainda');
console.log(cor(90, `     ${pedido.codigo} · ${brl(pedido.total_centavos)} autorizados no final ${pedido.pagamento.cartao_final}`));

// ---------- 5. a loja aceita ----------
console.log(cor(1, '\n5. painel da loja'));
const fila = (await api('GET', `/api/comercio/${loja.id}/pedidos`, { token: tGerente })).dados;
ok(fila.some((o) => o.id === pedido.id), `pedido apareceu na fila da loja (${fila.length} na fila)`);

const semPermissao = await api('POST', `/api/comercio/${loja.id}/pedidos/${pedido.id}/aceitar`, { token: tCliente });
ok(semPermissao.status === 403, 'cliente NÃO consegue aceitar pedido pela loja', semPermissao.dados);

const aceito = (await api('POST', `/api/comercio/${loja.id}/pedidos/${pedido.id}/aceitar`, { token: tGerente })).dados;
ok(aceito.status === 'em_separacao', `receita já validada vira saldo: foi direto para ${aceito.status}`);

// ---------- 6. ruptura vira contraproposta ----------
console.log(cor(1, '\n6. faltou um item'));
const itemVitamina = aceito.itens.find((i) => i.nome_snapshot.includes('Vitamina'));
await api('POST', `/api/comercio/${loja.id}/pedidos/${pedido.id}/itens/${itemVitamina.id}/indisponivel`, { token: tGerente });
const comOferta = (await api('POST', `/api/comercio/${loja.id}/pedidos/${pedido.id}/itens/${itemVitamina.id}/substituir`,
  { token: tGerente, corpo: { ean: '7896112100034' } })).dados;
ok(comOferta.status === 'aguardando_cliente', 'pedido espera a resposta do cliente, não é cancelado');
ok(comOferta.ofertas.length === 1, 'contraproposta registrada');

const oferta = comOferta.ofertas[0];
const respondido = (await api('POST', `/api/pedidos/${pedido.id}/ofertas/${oferta.id}`,
  { token: tCliente, corpo: { aceitar: true } })).dados;
ok(respondido.status === 'em_separacao', 'cliente aceitou e o pedido voltou a andar');

// ---------- 7. separação captura o cartão ----------
console.log(cor(1, '\n7. separação e cobrança'));
const antes = (await api('GET', `/api/pedidos/${pedido.id}`, { token: tCliente })).dados;
ok(antes.pagamento.status === 'autorizado', 'até aqui ainda não cobrou nada');

const pronto = (await api('POST', `/api/comercio/${loja.id}/pedidos/${pedido.id}/pronto`, {
  token: tGerente, corpo: { conferencia: antes.itens
    .filter((i) => i.status !== 'indisponivel')
    .map((i) => ({ item_id: i.id, lote: 'M4482', validade: '2028-08-31' })) } })).dados;
ok(pronto.status === 'pronto', 'pedido separado');

const depois = (await api('GET', `/api/pedidos/${pedido.id}`, { token: tCliente })).dados;
ok(depois.pagamento.status === 'capturado', 'AGORA sim o cartão foi capturado');
ok(depois.pagamento.valor_capturado_centavos <= depois.pagamento.valor_autorizado_centavos,
   `capturou ${brl(depois.pagamento.valor_capturado_centavos)} de ${brl(depois.pagamento.valor_autorizado_centavos)} autorizados`);
ok(depois.itens.some((i) => i.lote === 'M4482'), 'lote e validade gravados — rastreabilidade de recall');

// ---------- 8. entrega em mãos ----------
console.log(cor(1, '\n8. entrega'));
const tarefas = (await api('GET', '/api/entregador/tarefas', { token: tMoto })).dados;
ok(tarefas.some((t) => t.id === pedido.id), 'pedido apareceu para o entregador');
ok(tarefas.find((t) => t.id === pedido.id)?.exige_maos === 1, 'marcado como entrega em mãos');

await api('POST', `/api/entregador/entregas/${pedido.id}/retirar`, { token: tMoto });
const semRecebedor = await api('POST', `/api/entregador/entregas/${pedido.id}/entregar`, { token: tMoto, corpo: {} });
ok(semRecebedor.status === 422, 'entrega sem registrar quem recebeu é bloqueada', semRecebedor.dados);

const entregue = (await api('POST', `/api/entregador/entregas/${pedido.id}/entregar`, {
  token: tMoto, corpo: { recebido_por: 'Jhony R.', documento: '***.456.789-**' } })).dados;
ok(entregue.status === 'entregue', 'pedido entregue');

// ---------- 8b. o fecho do ciclo ----------
console.log('');
console.log(cor(1, '8b. avaliação'));
const notaBaixa = await api('POST', `/api/pedidos/${pedido.id}/avaliar`,
  { token: tCliente, corpo: { nota: 2 } });
ok(notaBaixa.status === 422 && notaBaixa.dados.erro === 'MOTIVO_OBRIGATORIO',
   'nota baixa sem motivo é recusada — reclamação sem causa não conserta nada');

const avaliado = (await api('POST', `/api/pedidos/${pedido.id}/avaliar`, { token: tCliente,
  corpo: { nota: 5, marcas: ['Chegou antes', 'Entregador atencioso'] } })).dados;
ok(avaliado.nota === 5, `avaliado com ${avaliado.nota} estrelas`);

const repetida = await api('POST', `/api/pedidos/${pedido.id}/avaliar`,
  { token: tCliente, corpo: { nota: 4 } });
ok(repetida.status === 409, 'não dá para avaliar duas vezes');

const reputacao = (await api('GET', `/api/comercio/${loja.id}/reputacao`, { token: tGerente })).dados;
ok(reputacao.media === 5, `reputação da loja: ${reputacao.media} em ${reputacao.avaliacoes} avaliação(ões)`);
ok(reputacao.marcas.length === 2, 'as marcas viram contagem para a loja agir');

// ---------- 9. a receita virou saldo ----------
console.log(cor(1, '\n9. saldo da receita'));
const receitas = (await api('GET', '/api/receitas', { token: tCliente })).dados;
const losartana = receitas
  .flatMap((r) => r.itens)
  .find((i) => i.principio_ativo?.includes('Losartana'));
ok(losartana.qtd_usada === 1, `consumiu 1 caixa; saldo agora ${losartana.saldo} de ${losartana.qtd_prescrita}`);

// ---------- 10. fila do farmacêutico, com receita nova ----------
console.log(cor(1, '\n10. receita nova passa pelo farmacêutico'));
const nova = (await api('POST', '/api/receitas', { token: tCliente, corpo: {
  arquivo_url: '/receitas/amoxicilina.jpg',
  prescritor: { nome: 'RUI BARRETO', crm: '9907', uf: 'CE' },
  emitida_em: '2026-09-13', valida_ate: '2026-09-23',
  itens: [{ ean: '7896241400234', qtd_prescrita: 1 }],
} })).dados;
ok(nova.status === 'pendente', 'receita entra pendente, nunca pré-aprovada');

const p2 = (await api('POST', '/api/pedidos', { token: tCliente, corpo: {
  pharmacy_id: loja.id, address_id: meuEndereco.id,
  itens: [{ ean: '7896241400234', qtd: 1 }], prescription_id: nova.id } })).dados;
await api('POST', `/api/comercio/${loja.id}/pedidos/${p2.id}/aceitar`, { token: tGerente });
const emEspera = (await api('GET', `/api/pedidos/${p2.id}`, { token: tCliente })).dados;
ok(emEspera.status === 'aguardando_receita', 'antibiótico segura o pedido na fila do farmacêutico');

const tentativaGerente = await api('POST', `/api/comercio/${loja.id}/receitas/${nova.id}/liberar`, { token: tGerente });
ok(tentativaGerente.status === 403, 'gerente SEM CRF não consegue liberar receita', tentativaGerente.dados);

const recusaSemMotivo = await api('POST', `/api/comercio/${loja.id}/receitas/${nova.id}/recusar`,
  { token: tFarma, corpo: { motivo: 'x' } });
ok(recusaSemMotivo.status === 422, 'recusa sem motivo escrito é bloqueada');

const liberada = (await api('POST', `/api/comercio/${loja.id}/receitas/${nova.id}/liberar`, { token: tFarma })).dados;
ok(liberada.status === 'validada', `liberada por ${liberada.validada_crf}`);
const andou = (await api('GET', `/api/pedidos/${p2.id}`, { token: tCliente })).dados;
ok(andou.status === 'em_separacao', 'o pedido andou sozinho quando a receita foi liberada');
ok(andou.linha_do_tempo.some((e) => e.ator_tipo === 'farmaceutico'),
   'o farmacêutico aparece na linha do tempo do cliente');

// ---------- 11. cancelar estorna e solta estoque ----------
console.log(cor(1, '\n11. cancelamento'));
const tarde = await api('POST', `/api/pedidos/${p2.id}/cancelar`,
  { token: tCliente, corpo: { motivo: 'Desisti' } });
ok(tarde.status === 409, 'cliente NÃO cancela sozinho depois que a loja começou a separar', tarde.dados);

const cancelado = (await api('POST', `/api/comercio/${loja.id}/pedidos/${p2.id}/recusar`,
  { token: tGerente, corpo: { motivo: 'Cliente pediu por telefone' } })).dados;
ok(cancelado.status === 'cancelado', 'a loja cancela, com motivo registrado');
const pag2 = (await api('GET', `/api/pedidos/${p2.id}`, { token: tCliente })).dados.pagamento;
ok(pag2.status === 'estornado', 'autorização estornada — o cliente nunca vê a cobrança');

// ---------- 12. o que a loja e o admin enxergam ----------
console.log(cor(1, '\n12. indicadores'));
const ind = (await api('GET', `/api/comercio/${loja.id}/indicadores`, { token: tGerente })).dados;
ok(typeof ind.ruptura_pct === 'number', `ruptura do dia: ${ind.ruptura_pct}%`);
ok(ind.entregues_hoje >= 1, `${ind.entregues_hoje} entregue(s) hoje · a receber ${brl(ind.a_receber_centavos)}`);

const adm = (await api('GET', '/api/admin/indicadores', { token: tAdmin })).dados;
ok(adm.gmv_centavos > 0, `GMV ${brl(adm.gmv_centavos)} · receita da plataforma ${brl(adm.receita_centavos)}`);
ok(adm.farmacias_ativas === 1, `${adm.farmacias_ativas} farmácia ativa — loja própria, não marketplace`);

const negado = await api('GET', '/api/admin/indicadores', { token: tCliente });
ok(negado.status === 403, 'cliente não enxerga o painel da plataforma');

// ---------- 13. cadastro de uma farmácia nova ----------
console.log(cor(1, '\n13. cadastro do comércio'));
const cnpj = '99' + Date.now().toString().slice(-12);
const cad = (await api('POST', '/api/comercio/cadastro', { corpo: {
  cnpj, razao_social: 'Drogaria Teste LTDA', nome_fantasia: 'Drogaria Teste', bairro: 'Aldeota',
  gerente: { nome: 'Dono Teste', email: `dono${Date.now()}@teste.com`, senha: 'teste123' } } })).dados;
ok(cad.status === 'rascunho', 'farmácia nasce em rascunho');
ok(cad.docs_faltando.length === 7,
   `faltam os 7 documentos obrigatórios, incluindo o aditivo da AFE com o domínio: ${cad.docs_faltando.join(', ')}`);

const tDono = await login(cad.equipe[0].email, 'teste123');
const cedo = await api('POST', `/api/comercio/${cad.id}/submeter`, { token: tDono });
ok(cedo.status === 422 && cedo.dados.erro === 'DOCUMENTOS_FALTANDO',
   'não dá pra submeter sem a papelada');

for (const tipo of cad.docs_faltando) {
  await api('POST', `/api/comercio/${cad.id}/docs`, { token: tDono,
    corpo: { tipo, numero: 'X', validade: '2027-12-31', arquivo_url: '/x.pdf',
             dominio: tipo === 'aditivo_afe_dominio' ? 'solmedic.com.br' : undefined } });
}
const semRT = await api('POST', `/api/comercio/${cad.id}/submeter`, { token: tDono });
ok(semRT.dados.erro === 'SEM_RESPONSAVEL_TECNICO', 'nem sem farmacêutico responsável técnico');

await api('POST', `/api/comercio/${cad.id}/equipe`, { token: tDono, corpo: {
  nome: 'Farm Teste', email: `farm${Date.now()}@teste.com`, senha: 'teste123',
  papel: 'farmaceutico', crf: '1234', crf_uf: 'CE', responsavel_tecnico: 1 } });
const submetida = (await api('POST', `/api/comercio/${cad.id}/submeter`, { token: tDono })).dados;
ok(submetida.status === 'em_analise', 'com tudo em ordem, entra em análise');

const aprovada = (await api('POST', `/api/admin/farmacias/${cad.id}/decidir`,
  { token: tAdmin, corpo: { aprovar: true } })).dados;
ok(aprovada.status === 'ativa', 'admin aprovou — agora ela pode vender');

// ---------- 14. preço acima do PMC é recusado ----------
console.log(cor(1, '\n14. teto de preço'));
const caro = await api('POST', `/api/comercio/${loja.id}/catalogo`, { token: tGerente,
  corpo: { ean: '7896004704128', preco_centavos: 9900, estoque: 5 } });
ok(caro.status === 422 && caro.dados.erro === 'ACIMA_DO_PMC',
   'preço acima do PMC da CMED é barrado', caro.dados);

const csv = (await api('POST', `/api/comercio/${loja.id}/catalogo/importar`, { token: tGerente,
  corpo: { csv: 'ean;preco;socio;estoque\n7896004701127;11,90;10,10;33\n0000000000000;9,90;;5' } })).dados;
ok(csv.ok === 1 && csv.erros.length === 1, `CSV: ${csv.ok} ok, ${csv.erros.length} erro apontado com linha`);

// ---------- fim ----------
console.log('\n' + (falhou === 0
  ? cor(32, `  ${passou} verificações passaram. O caminho inteiro funciona.\n`)
  : cor(31, `  ${passou} passaram, ${falhou} falharam.\n`)));
await api('PUT', '/api/admin/config', { token: await login('admin@solmedic.app', 'admin123'),
  corpo: { receita_habilitada: false } });
process.exitCode = falhou ? 1 : 0;
