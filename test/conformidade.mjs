/**
 * As regras de receita, cobradas uma a uma.
 * É o teste que diz se a plataforma pode existir — o outro diz se ela funciona.
 *   npm run dev   e depois   node test/conformidade.mjs
 */
const BASE = process.env.CV_API || 'http://localhost:4173';
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
const hoje = () => new Date().toISOString().slice(0, 10);
const diasAtras = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

console.log(cor(1, '\nCONFORMIDADE DA RECEITA\n'));

const cli = await login('cliente@exemplo.com', 'cliente123');
const ger = await login('gerente@solmedic.com.br', 'loja123');
const farma = await login('farmaceutica@solmedic.com.br', 'crf123');
const moto = await login('entregador@solmedic.com.br', 'moto123');
// a máquina de receita é testada ligada; a operação real começa desligada
await api('PUT', '/api/admin/config', { token: await login('admin@solmedic.app', 'admin123'),
  corpo: { receita_habilitada: true } });

const loja = (await api('GET', '/api/farmacias')).dados.find((l) => l.nome_fantasia.includes('Solmedic'));
const end = (await api('GET', '/api/enderecos', { token: cli })).dados[0];

const AMOX = '7896241400234';   // antimicrobiano — retenção obrigatória
const CLONA = '7896006210016';  // Portaria 344 — venda remota vedada
const GLP1 = '7898040273067';   // GLP-1 — entrou na retenção em 2025
const LOSA = '7896004704128';   // tarja vermelha sem retenção

// ---------- 1. o que não pode ser vendido remoto ----------
console.log(cor(1, '1. venda remota vedada (RDC 44/2009 art. 52 §2º)'));
const ctrl = await api('POST', '/api/carrinho/orcamento', {
  token: cli, corpo: { pharmacy_id: loja.id, itens: [{ ean: CLONA, qtd: 1 }] } });
ok(ctrl.status === 422 && ctrl.dados.erro === 'CONTROLADO_FORA_DA_PLATAFORMA',
   'clonazepam barrado no orçamento');
ok(/art\. 52/.test(ctrl.dados.mensagem || ''), 'a mensagem cita a norma, não só "não pode"', ctrl.dados.mensagem);

const ctrlReceita = await api('POST', '/api/receitas', { token: cli, corpo: {
  arquivo_url: '/x.jpg', itens: [{ ean: CLONA, qtd_prescrita: 1 }] } });
ok(ctrlReceita.status === 422, 'e também barrado no envio da receita');

// ---------- 2. classificação e validade ----------
console.log(cor(1, '\n2. validade por classe'));
const rAmox = (await api('POST', '/api/receitas', { token: cli, corpo: {
  arquivo_url: '/uploads/amox.jpg', emitida_em: hoje(),
  prescritor: { nome: 'RUI BARRETO', crm: '9907', uf: 'CE' },
  itens: [{ ean: AMOX, qtd_prescrita: 1, posologia: '1 cápsula 8/8h' }] } })).dados;
const dias = Math.round((Date.parse(rAmox.valida_ate) - Date.parse(hoje())) / 864e5);
ok(dias === 10, `antimicrobiano vence em 10 dias (calculado: ${dias})`, rAmox.valida_ate);
ok(rAmox.exige_retencao === 1, 'receita marcada como sujeita a retenção');
ok(rAmox.itens[0].consumo === 'integral', 'item é consumido inteiro — não gera saldo');
ok(rAmox.precisa_via_fisica === true, 'via física precisa chegar na farmácia');

const rGlp = (await api('POST', '/api/receitas', { token: cli, corpo: {
  arquivo_url: '/uploads/glp.jpg', emitida_em: hoje(),
  itens: [{ ean: GLP1, qtd_prescrita: 1 }] } })).dados;
ok(rGlp.exige_retencao === 1, 'GLP-1 também exige retenção (RDC 1.000/2025)');

// ---------- 3. papel não é prescrição eletrônica ----------
console.log(cor(1, '\n3. origem da receita'));
const semCodigo = await api('POST', '/api/receitas', { token: cli, corpo: {
  origem: 'eletronica', itens: [{ ean: AMOX, qtd_prescrita: 1 }] } });
ok(semCodigo.status === 400 && semCodigo.dados.erro === 'SEM_CODIGO',
   'eletrônica sem código de validação é recusada');

const assinaturaFraca = await api('POST', '/api/receitas', { token: cli, corpo: {
  origem: 'eletronica', codigo_validacao: 'ABC1234567', plataforma: 'memed',
  tipo_assinatura: 'simples', itens: [{ ean: AMOX, qtd_prescrita: 1 }] } });
ok(assinaturaFraca.status === 422 && assinaturaFraca.dados.erro === 'ASSINATURA_INSUFICIENTE',
   'retenção exige assinatura qualificada ou avançada', assinaturaFraca.dados.mensagem);

const codigo = 'CV' + Date.now().toString().slice(-8);
const eletronica = (await api('POST', '/api/receitas', { token: cli, corpo: {
  origem: 'eletronica', codigo_validacao: codigo, plataforma: 'memed',
  tipo_assinatura: 'avancada', emitida_em: hoje(),
  prescritor: { nome: 'MARINA ALVES', crm: '18432', uf: 'CE' },
  itens: [{ ean: AMOX, qtd_prescrita: 1, posologia: '1 cápsula 8/8h' }] } })).dados;
ok(eletronica.id, 'eletrônica com assinatura avançada é aceita');
ok(eletronica.precisa_via_fisica === false, 'eletrônica não pede via de papel');

const repetida = await api('POST', '/api/receitas', { token: cli, corpo: {
  origem: 'eletronica', codigo_validacao: codigo, plataforma: 'memed',
  tipo_assinatura: 'avancada', itens: [{ ean: AMOX, qtd_prescrita: 1 }] } });
ok(repetida.status === 409 && repetida.dados.erro === 'CODIGO_JA_USADO',
   'o mesmo código não entra duas vezes — é o anti-reuso');

// ---------- 4. o farmacêutico precisa ler antes de liberar ----------
console.log(cor(1, '\n4. leitura pelo farmacêutico'));
const soFoto = (await api('POST', '/api/receitas', { token: cli, corpo: {
  arquivo_url: '/uploads/foto.jpg' } })).dados;
ok(soFoto.itens.length === 0, 'foto sobe sem medicamento nem dose');

const liberarVazia = await api('POST', `/api/comercio/${loja.id}/receitas/${soFoto.id}/liberar`, { token: farma });
ok(liberarVazia.status === 422 && liberarVazia.dados.erro === 'RECEITA_SEM_ITENS',
   'não dá para liberar receita sem medicamento preenchido');

const preenchida = (await api('POST', `/api/comercio/${loja.id}/receitas/${soFoto.id}/preencher`, {
  token: farma, corpo: {
    prescritor: { nome: 'MARINA ALVES', crm: '18432', uf: 'CE' }, emitida_em: hoje(),
    itens: [{ ean: LOSA, qtd_prescrita: 3, posologia: '1 comprimido ao dia' }], uso_continuo: 1 } })).dados;
ok(preenchida.itens.length === 1, 'o farmacêutico preencheu o que a foto não dizia');
ok(preenchida.itens[0].consumo === 'saldo', 'uso contínuo sem retenção gera saldo');

const gerentePreenche = await api('POST', `/api/comercio/${loja.id}/receitas/${soFoto.id}/preencher`,
  { token: ger, corpo: { itens: [] } });
ok(gerentePreenche.status === 403, 'gerente sem CRF não preenche receita');

// ---------- 5. receita vencida ----------
console.log(cor(1, '\n5. receita fora do prazo'));
const velha = (await api('POST', '/api/receitas', { token: cli, corpo: {
  arquivo_url: '/uploads/velha.jpg', emitida_em: diasAtras(20),
  itens: [{ ean: AMOX, qtd_prescrita: 1 }] } })).dados;
const liberarVelha = await api('POST', `/api/comercio/${loja.id}/receitas/${velha.id}/liberar`, { token: farma });
ok(liberarVelha.status === 422 && liberarVelha.dados.erro === 'RECEITA_VENCIDA',
   'antimicrobiano emitido há 20 dias não é liberado', liberarVelha.dados.mensagem);

// ---------- 6. o caminho do papel: a via tem que voltar ----------
console.log(cor(1, '\n6. retenção da via física'));
const pedido = (await api('POST', '/api/pedidos', { token: cli, corpo: {
  pharmacy_id: loja.id, address_id: end.id, itens: [{ ean: AMOX, qtd: 1 }],
  prescription_id: rAmox.id } })).dados;
ok(pedido.exige_coleta_receita === 1, 'pedido nasce marcado para recolher a via');
ok(pedido.entrega.coletar_receita === 1, 'a entrega carrega a tarefa de recolher');

await api('POST', `/api/comercio/${loja.id}/pedidos/${pedido.id}/aceitar`, { token: ger });
const esperando = (await api('GET', `/api/pedidos/${pedido.id}`, { token: cli })).dados;
ok(esperando.status === 'aguardando_receita', 'pedido espera o farmacêutico');

await api('POST', `/api/comercio/${loja.id}/receitas/${rAmox.id}/liberar`, { token: farma });
const liberado = (await api('GET', `/api/pedidos/${pedido.id}`, { token: cli })).dados;
ok(liberado.status === 'em_separacao', 'liberou e o pedido andou');

const receitaDepois = (await api('GET', `/api/receitas/${rAmox.id}`, { token: cli })).dados;
ok(!receitaDepois.retida_em, 'receita de papel NÃO fica retida só por ser liberada');

await api('POST', `/api/comercio/${loja.id}/pedidos/${pedido.id}/pronto`, { token: ger, corpo: { conferencia: [] } });
await api('POST', `/api/entregador/entregas/${pedido.id}/retirar`, { token: moto });

const semRecolher = await api('POST', `/api/entregador/entregas/${pedido.id}/entregar`, {
  token: moto, corpo: { recebido_por: 'Jhony R.' } });
ok(semRecolher.status === 422 && semRecolher.dados.erro === 'EXIGE_COLETA_DA_RECEITA',
   'entregador não conclui sem recolher a via', semRecolher.dados.mensagem);

const entregue = (await api('POST', `/api/entregador/entregas/${pedido.id}/entregar`, {
  token: moto, corpo: { recebido_por: 'Jhony R.', documento: '***.456.789-**', receita_coletada: true } })).dados;
ok(entregue.status === 'entregue', 'com a via recolhida, a entrega conclui');
ok(!!entregue.entrega.receita_coletada_em, 'a hora da coleta fica registrada');

// ---------- 7. a loja ainda deve a retenção ----------
console.log(cor(1, '\n7. a pendência que sobra na loja'));
const fila = (await api('GET', `/api/comercio/${loja.id}/receitas/retencao`, { token: farma })).dados;
ok(fila.some((r) => r.id === rAmox.id), `${fila.length} receita(s) aguardando arquivo na loja`);

const ind = (await api('GET', `/api/comercio/${loja.id}/indicadores`, { token: ger })).dados;
ok(ind.retencoes_pendentes >= 1, `painel mostra ${ind.retencoes_pendentes} retenção(ões) pendente(s)`);

const semLote = await api('POST', `/api/comercio/${loja.id}/receitas/${rAmox.id}/retencao`, {
  token: farma, corpo: { quantidade_dispensada: 1 } });
ok(semLote.status === 422 && semLote.dados.erro === 'LOTE_OBRIGATORIO',
   'retenção sem lote é recusada — sem lote não há rastreabilidade');

const retida = (await api('POST', `/api/comercio/${loja.id}/receitas/${rAmox.id}/retencao`, {
  token: farma, corpo: { registro_numero: 'REG-2026-0044', quantidade_dispensada: 1,
    lote: 'AX7712', validade_lote: '2028-03-31' } })).dados;
ok(retida.retida_em && retida.retida_via === 'fisica', 'retenção registrada, via física');
ok(retida.retencoes[0].crf === '9214-CE', `com o CRF de quem reteve: ${retida.retencoes[0].crf}`);
ok(retida.retencoes[0].lote === 'AX7712', 'lote e validade guardados junto');
ok(retida.itens[0].saldo === 0, 'receita retida zera o saldo — não serve para um segundo pedido');

// ---------- 8. tentar reusar a receita retida ----------
console.log(cor(1, '\n8. reuso'));
const segundo = await api('POST', '/api/pedidos', { token: cli, corpo: {
  pharmacy_id: loja.id, address_id: end.id, itens: [{ ean: AMOX, qtd: 1 }],
  prescription_id: rAmox.id } });
ok(segundo.status === 422 && segundo.dados.erro === 'RECEITA_NECESSARIA',
   'a mesma receita não compra o antibiótico duas vezes');

// ---------- 9. eletrônica: a baixa é no ato ----------
console.log(cor(1, '\n9. baixa digital'));
const pedElet = (await api('POST', '/api/pedidos', { token: cli, corpo: {
  pharmacy_id: loja.id, address_id: end.id, itens: [{ ean: AMOX, qtd: 1 }],
  prescription_id: eletronica.id } })).dados;
ok(pedElet.exige_coleta_receita === 0, 'pedido com receita eletrônica não pede via de papel');
await api('POST', `/api/comercio/${loja.id}/pedidos/${pedElet.id}/aceitar`, { token: ger });
await api('POST', `/api/comercio/${loja.id}/receitas/${eletronica.id}/liberar`, { token: farma });
const eletDepois = (await api('GET', `/api/receitas/${eletronica.id}`, { token: cli })).dados;
ok(eletDepois.retida_em && eletDepois.retida_via === 'digital',
   'eletrônica é retida no ato da liberação, digitalmente');
ok(eletDepois.assinatura_validada === 1, 'assinatura marcada como conferida');
ok(/código/.test(eletDepois.retencoes[0]?.observacao || ''),
   'a baixa registra o código da plataforma emissora');

// ---------- 10. dados obrigatórios de vitrine ----------
console.log(cor(1, '\n10. o que a RDC 44 manda exibir'));
const vitrine = (await api('GET', `/api/farmacias/${loja.id}`)).dados;
for (const campo of ['razao_social', 'nome_fantasia', 'cnpj', 'logradouro', 'telefone']) {
  ok(!!vitrine[campo], `a loja expõe ${campo}`);
}
ok(!!vitrine.responsavel_tecnico?.crf, `responsável técnico com CRF: ${vitrine.responsavel_tecnico?.nome} · ${vitrine.responsavel_tecnico?.crf}`);
ok(vitrine.horarios?.length === 7, 'horário de funcionamento dos 7 dias');
ok(vitrine.dominio_afe === 'solmedic.com.br', `domínio declarado na AFE: ${vitrine.dominio_afe}`);

// ---------- 11. cadastro exige o aditivo da AFE ----------
console.log(cor(1, '\n11. onboarding'));
const cnpj = '88' + Date.now().toString().slice(-12);
const nova = (await api('POST', '/api/comercio/cadastro', { corpo: {
  cnpj, razao_social: 'Drogaria Nova LTDA', nome_fantasia: 'Drogaria Nova', bairro: 'Aldeota',
  gerente: { nome: 'Dona Nova', email: `nova${Date.now()}@teste.com`, senha: 'teste123' } } })).dados;
ok(nova.docs_faltando.includes('aditivo_afe_dominio'),
   'o aditivo da AFE com o domínio entra na lista de obrigatórios');

const tDono = await login(nova.equipe[0].email, 'teste123');
const semDominio = await api('POST', `/api/comercio/${nova.id}/docs`, {
  token: tDono, corpo: { tipo: 'aditivo_afe_dominio', numero: 'AFE-1' } });
ok(semDominio.status === 422 && semDominio.dados.erro === 'DOMINIO_OBRIGATORIO',
   'não aceita o aditivo sem dizer qual domínio consta na AFE');

console.log('\n' + (falhou === 0
  ? cor(32, `  ${passou} verificações passaram. As regras de receita estão de pé.\n`)
  : cor(31, `  ${passou} passaram, ${falhou} falharam.\n`)));
await api('PUT', '/api/admin/config', { token: await login('admin@solmedic.app', 'admin123'),
  corpo: { receita_habilitada: false } });
process.exitCode = falhou ? 1 : 0;
