/**
 * O painel da casa: CRM, estoque por lote e foto de produto.
 *
 * É a parte que não aparece para o cliente e decide se a farmácia dá
 * lucro — controle de lote, validade, custo, e saber quem some.
 *
 *   npm run dev   e depois   node test/gestao.mjs
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

console.log(cor(1, '\nGESTÃO DA CASA\n'));

const ger = await login('gerente@solmedic.com.br', 'loja123');
const cli = await login('cliente@exemplo.com', 'cliente123');
const moto = await login('entregador@solmedic.com.br', 'moto123');
const loja = (await api('GET', '/api/config')).dados.farmacia;
const L = loja.id;
const end = (await api('GET', '/api/enderecos', { token: cli })).dados[0];
const VITC = '7891142199058';

// ---------- 1. entrada de nota ----------
console.log(cor(1, '1. o que entra pela porta dos fundos'));
const antes = (await api('GET', `/api/comercio/${L}/estoque?q=${VITC}`, { token: ger }))
  .dados.find((i) => i.ean === VITC);
ok(!!antes, `posição do estoque lida: ${antes?.estoque} un de ${antes?.nome}`);
ok(antes.custo_centavos > 0 && antes.margem_pct > 0,
   `custo e margem vêm da nota: ${antes.margem_pct}% sobre ${antes.custo_centavos}`);

const semLote = await api('POST', `/api/comercio/${L}/estoque/entrada`, { token: ger, corpo: {
  ean: VITC, qtd: 10 } });
ok(semLote.status === 422 && semLote.dados.erro === 'LOTE_OBRIGATORIO',
   'entrada sem lote é recusada — é o lote que faz o recall funcionar', semLote.dados);

const vencido = await api('POST', `/api/comercio/${L}/estoque/entrada`, { token: ger, corpo: {
  ean: VITC, lote: 'XX1', qtd: 5, validade: emDias(-3) } });
ok(vencido.status === 422 && vencido.dados.erro === 'JA_VENCIDO',
   'lote que já venceu não entra na prateleira', vencido.dados);

const LOTE = 'NF' + Date.now().toString().slice(-5);
const ent = await api('POST', `/api/comercio/${L}/estoque/entrada`, { token: ger, corpo: {
  ean: VITC, lote: LOTE, validade: emDias(25), qtd: 12, custo_centavos: 1180,
  fornecedor: 'Servimed', nota_fiscal: '99123' } });
ok(ent.status === 201, 'entrada registrada', ent.dados);
ok(ent.dados.saldo === antes.estoque + 12, `saldo subiu de ${antes.estoque} para ${ent.dados.saldo}`);

const lotes = (await api('GET', `/api/comercio/${L}/estoque/${VITC}/lotes`, { token: ger })).dados;
ok(lotes.some((l) => l.lote === LOTE && l.qtd === 12), 'o lote existe com a quantidade da nota');
ok(lotes.find((l) => l.lote === LOTE)?.fornecedor === 'Servimed', 'e guarda de quem foi comprado');

// ---------- 2. FEFO ----------
console.log(cor(1, '\n2. vence primeiro, sai primeiro'));
const antesLotes = (await api('GET', `/api/comercio/${L}/estoque/${VITC}/lotes`, { token: ger })).dados
  .filter((l) => l.qtd > 0 && !l.bloqueado);
// a regra é a da farmácia, não a minha: o primeiro da fila é o que vence antes
const esperado = antesLotes[0];

const pedido = (await api('POST', '/api/pedidos', { token: cli, corpo: {
  pharmacy_id: L, itens: [{ ean: VITC, qtd: 2 }], metodo: 'cartao',
  cartao_final: '4417', address_id: end.id } })).dados;
await api('POST', `/api/comercio/${L}/pedidos/${pedido.id}/aceitar`, { token: ger });
await api('POST', `/api/comercio/${L}/pedidos/${pedido.id}/pronto`, {
  token: ger, corpo: { conferencia: [] } });

const doPedido = (await api('GET', `/api/pedidos/${pedido.id}`, { token: cli })).dados;
ok(doPedido.itens[0].lote === esperado.lote,
   `ninguém digitou lote e o sistema escolheu o que vence antes (${doPedido.itens[0].lote},`
   + ` vence ${esperado.validade})`, { escolhido: doPedido.itens[0].lote, esperado: esperado.lote });
ok(doPedido.itens[0].validade === esperado.validade, 'e gravou a validade daquele lote no item');

const depois = (await api('GET', `/api/comercio/${L}/estoque/${VITC}/lotes`, { token: ger })).dados;
ok(depois.find((l) => l.id === esperado.id)?.qtd === esperado.qtd - 2,
   'a baixa saiu do lote certo, não de um saldo solto');

const conf = (await api('GET', `/api/comercio/${L}/estoque/conferencia`, { token: ger })).dados;
ok(!conf.some((c) => c.ean === VITC), 'saldo e soma dos lotes continuam batendo');

// ---------- 3. contagem e perda ----------
console.log(cor(1, '\n3. o que some tem nome'));
const mudo = await api('POST', `/api/comercio/${L}/estoque/contagem`, { token: ger, corpo: {
  ean: VITC, qtd_contada: 40 } });
ok(mudo.status === 422 && mudo.dados.erro === 'MOTIVO_OBRIGATORIO',
   'diferença de contagem sem motivo é recusada — é assim que sumiço vira "ajuste"', mudo.dados);

const cont = await api('POST', `/api/comercio/${L}/estoque/contagem`, { token: ger, corpo: {
  ean: VITC, qtd_contada: 40, motivo: 'contagem de prateleira do turno da manhã' } });
ok(cont.status === 200 && cont.dados.saldo === 40, `contagem ajustou para ${cont.dados.saldo}`);

const kardex = (await api('GET', `/api/comercio/${L}/estoque/${VITC}/kardex`, { token: ger })).dados;
ok(kardex[0].tipo === 'ajuste' && kardex[0].motivo.includes('turno da manhã'),
   'o ajuste entrou no kardex com o motivo escrito');
ok(kardex.some((m) => m.tipo === 'venda' && m.codigo === pedido.codigo),
   'e a venda do pedido também está lá, com o código');
ok(kardex.some((m) => m.tipo === 'entrada' && m.motivo === 'NF 99123'),
   'e a entrada, com o número da nota');

const loteAtual = (await api('GET', `/api/comercio/${L}/estoque/${VITC}/lotes`, { token: ger }))
  .dados.find((l) => l.lote === LOTE);
const perdaDemais = await api('POST', `/api/comercio/${L}/estoque/perda`, { token: ger, corpo: {
  lote_id: loteAtual.id, qtd: 999, motivo: 'teste' } });
ok(perdaDemais.status === 422, 'não dá para perder mais do que existe no lote');

const perda = await api('POST', `/api/comercio/${L}/estoque/perda`, { token: ger, corpo: {
  lote_id: loteAtual.id, qtd: 2, motivo: 'caixa amassada na descarga' } });
ok(perda.status === 200, 'perda baixada com motivo', perda.dados);
ok(perda.dados.perdido_centavos === 2360, `e contabilizada a custo: ${perda.dados.perdido_centavos}`);

const resumo = (await api('GET', `/api/comercio/${L}/estoque/resumo`, { token: ger })).dados;
ok(resumo.perdas_mes_unidades >= 2, `o resumo do mês já conta a perda (${resumo.perdas_mes_unidades} un)`);
ok(resumo.valor_custo_centavos > 0 && resumo.valor_venda_centavos > resumo.valor_custo_centavos,
   `estoque vale ${resumo.valor_custo_centavos} a custo e ${resumo.valor_venda_centavos} a venda`);

const semPermissao = await api('POST', `/api/comercio/${L}/estoque/perda`, { token: cli, corpo: {
  lote_id: loteAtual.id, qtd: 1, motivo: 'tentativa indevida' } });
ok(semPermissao.status === 403, 'cliente não baixa estoque de ninguém');

// ---------- 4. validade na prateleira ----------
console.log(cor(1, '\n4. o que vence antes de vender'));
const venc = (await api('GET', `/api/comercio/${L}/estoque/vencendo?dias=60`, { token: ger })).dados;
const meu = venc.find((l) => l.lote === LOTE);
ok(!!meu, `${venc.length} lote(s) vencendo em 60 dias`);
ok(meu?.dias_para_vencer <= 26 && meu.parado_centavos > 0,
   `o lote novo aparece com ${meu?.dias_para_vencer} dias e ${meu?.parado_centavos} parados`);

const abc = (await api('GET', `/api/comercio/${L}/estoque/abc`, { token: ger })).dados;
ok(abc.length > 0 && abc[0].curva === 'A', `curva ABC montada: ${abc.length} itens, o topo é ${abc[0]?.nome}`);
ok(abc.every((i, k) => k === 0 || abc[k - 1].receita_centavos >= i.receita_centavos),
   'ordenada por faturamento, do maior para o menor');

// ---------- 5. CRM ----------
console.log(cor(1, '\n5. quem compra aqui'));
const carteira = (await api('GET', `/api/comercio/${L}/clientes`, { token: ger })).dados;
ok(carteira.length >= 8, `${carteira.length} clientes na carteira`);
ok(carteira.every((c) => c.segmento && c.ticket_centavos >= 0),
   'todo cliente sai classificado, com ticket calculado');

const fiel = carteira.find((c) => c.segmento === 'fiel');
const perdido = carteira.find((c) => c.segmento === 'perdido');
ok(!!fiel && fiel.pedidos >= 4, `"${fiel?.nome}" é fiel: ${fiel?.pedidos} pedidos`);
ok(!!perdido && perdido.dias_sem_comprar > 120,
   `"${perdido?.nome}" está perdido: ${perdido?.dias_sem_comprar} dias sem comprar`);

const emRisco = (await api('GET', `/api/comercio/${L}/clientes?segmento=em_risco`, { token: ger })).dados;
ok(emRisco.every((c) => c.segmento === 'em_risco'), `filtro por segmento devolve só o balde pedido`);

const porNome = (await api('GET', `/api/comercio/${L}/clientes?q=marta`, { token: ger })).dados;
ok(porNome.length === 1 && porNome[0].nome.includes('Marta'), 'busca por nome acha uma pessoa');

const segs = (await api('GET', `/api/comercio/${L}/clientes/segmentos`, { token: ger })).dados;
ok(segs.length === 5 && segs.reduce((t, s) => t + s.clientes, 0) === carteira.length,
   'os cinco baldes somam a carteira inteira', segs.map((s) => `${s.segmento}:${s.clientes}`));

const atrasados = (await api('GET', `/api/comercio/${L}/clientes/recompras`, { token: ger })).dados;
ok(atrasados.length > 0 && atrasados[0].atraso_dias > 0,
   `${atrasados.length} pessoa(s) passaram do próprio ritmo — a maior atrasada em ${atrasados[0]?.atraso_dias} dias`);
ok(atrasados.every((c) => c.intervalo_medio_dias),
   'e o atraso é medido contra o ritmo de cada uma, não contra uma régua fixa');

// ---------- 6. a ficha ----------
console.log(cor(1, '\n6. a ficha de uma pessoa'));
const alvo = atrasados[0] ?? carteira[0];
const ficha = (await api('GET', `/api/comercio/${L}/clientes/${alvo.id}`, { token: ger })).dados;
ok(ficha.cliente?.nome === alvo.nome, `ficha de ${ficha.cliente?.nome} aberta`);
ok(ficha.pedidos.length > 0 && ficha.favoritos.length > 0,
   `${ficha.pedidos.length} compras e ${ficha.favoritos.length} item(ns) recorrentes`);
ok(Array.isArray(ficha.armario), 'a ficha mostra o que a pessoa tem em casa');
ok(Array.isArray(ficha.enderecos) && ficha.enderecos.length > 0, 'e para onde entregar');

const nota = await api('POST', `/api/comercio/${L}/clientes/${alvo.id}/notas`, { token: ger, corpo: {
  texto: 'Prefere receber depois das 18h. Interfone quebrado, ligar no celular.', fixada: 1 } });
ok(nota.status === 201, 'a equipe deixa recado para a equipe');

const marcas = (await api('POST', `/api/comercio/${L}/clientes/${alvo.id}/marcas`, { token: ger,
  corpo: { marca: 'uso contínuo' } })).dados;
ok(marcas.includes('uso contínuo'), 'e marca o que é operacional', marcas);

const comNota = (await api('GET', `/api/comercio/${L}/clientes/${alvo.id}`, { token: ger })).dados;
ok(comNota.notas.some((n) => n.fixada && n.texto.includes('18h')), 'a nota fixada volta na ficha');
ok(comNota.notas[0].autor, 'assinada por quem escreveu');

const vazia = await api('POST', `/api/comercio/${L}/clientes/${alvo.id}/notas`, { token: ger, corpo: {
  texto: '  ' } });
ok(vazia.status === 422, 'nota vazia não entra');

const deFora = await api('GET', `/api/comercio/${L}/clientes`, { token: cli });
ok(deFora.status === 403, 'cliente não lê a carteira da loja');

// ---------- 7. campanha ----------
console.log(cor(1, '\n7. falar com um grupo'));
const semTexto = await api('POST', `/api/comercio/${L}/campanhas`, { token: ger, corpo: {
  segmento: 'em_risco', titulo: '', corpo: '' } });
ok(semTexto.status === 422, 'campanha sem texto não sai');

const segInventado = await api('POST', `/api/comercio/${L}/campanhas`, { token: ger, corpo: {
  segmento: 'vips', titulo: 'oi', corpo: 'oi' } });
ok(segInventado.status === 422, 'segmento que não existe é recusado');

const camp = await api('POST', `/api/comercio/${L}/campanhas`, { token: ger, corpo: {
  segmento: 'em_risco', titulo: 'A gente lembrou de você',
  corpo: 'Faz um tempo que não nos vemos. Precisa de alguma coisa?' } });
ok(camp.status === 201, 'campanha disparada', camp.dados);
ok(camp.dados.alcance === emRisco.length,
   `chegou nas ${camp.dados.alcance} pessoa(s) do segmento, nem uma a mais`);

const hist = (await api('GET', `/api/comercio/${L}/campanhas`, { token: ger })).dados;
ok(hist[0]?.autor, `o histórico registra quem disparou: ${hist[0]?.autor}`);

if (emRisco.length) {
  const quem = emRisco[0];
  const sessao = await login(quem.email, 'cliente123');
  const avisos = (await api('GET', '/api/notificacoes', { token: sessao })).dados;
  const chegou = (avisos.itens ?? avisos).find((n) => n.titulo === 'A gente lembrou de você');
  ok(!!chegou, 'e o aviso chegou de verdade no celular de quem estava no grupo');
}

// ---------- 8. foto real ----------
console.log(cor(1, '\n8. foto de produto'));
const naoEhImagem = await api('POST', `/api/comercio/${L}/catalogo/${VITC}/foto`, { token: ger,
  corpo: { dados: Buffer.from('isto aqui não é uma imagem').toString('base64') } });
ok(naoEhImagem.status === 422 && naoEhImagem.dados.erro === 'FORMATO_NAO_SUPORTADO',
   'arquivo que não é imagem é recusado pelos bytes, não pela extensão', naoEhImagem.dados);

// PNG 1x1 de verdade, montado byte a byte
const png = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478'
  + '9c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
const subiu = await api('POST', `/api/comercio/${L}/catalogo/${VITC}/foto`, { token: ger,
  corpo: { dados: png.toString('base64') } });
ok(subiu.status === 200 && subiu.dados.imagem_url === `/fotos/${VITC}.png`,
   `foto guardada em ${subiu.dados.imagem_url}`, subiu.dados);

const servida = await fetch(BASE + subiu.dados.imagem_url);
ok(servida.ok && servida.headers.get('content-type') === 'image/png',
   'e servida pelo servidor com o tipo certo');

const noApp = (await api('GET', `/api/catalogo/${VITC}`)).dados;
ok(noApp.imagem_url === subiu.dados.imagem_url,
   'o app do cliente já enxerga a foto no lugar do desenho');

const deFotoAlheia = await api('POST', `/api/comercio/${L}/catalogo/${VITC}/foto`, { token: cli,
  corpo: { dados: png.toString('base64') } });
ok(deFotoAlheia.status === 403, 'cliente não troca a foto do catálogo');

const apagou = await api('DELETE', `/api/comercio/${L}/catalogo/${VITC}/foto`, { token: ger });
ok(apagou.status === 200 && apagou.dados.imagem_url === null,
   'e dá para remover — o app volta para o desenho, sem buraco na vitrine');

// ---------- 9. a loja se edita ----------
console.log(cor(1, '\n9. a loja no comando dela mesma'));
const fretAntes = (await api('GET', `/api/comercio/${L}`, { token: ger })).dados.frete_centavos;
const mudou = await api('PUT', `/api/comercio/${L}`, { token: ger, corpo: {
  nome_fantasia: 'Solmedic+ Matriz', frete_centavos: 690, telefone: '85 3000-1234' } });
ok(mudou.status === 200 && mudou.dados.frete_centavos === 690,
   `frete mudou de ${fretAntes} para ${mudou.dados.frete_centavos} sem reiniciar nada`);

const semNome = await api('PUT', `/api/comercio/${L}`, { token: ger, corpo: { nome_fantasia: ' ' } });
ok(semNome.status === 422, 'loja sem nome é recusada');

const cnpjTeimoso = await api('PUT', `/api/comercio/${L}`, { token: ger, corpo: {
  cnpj: '00000000000000' } });
ok(cnpjTeimoso.dados.cnpj !== '00000000000000',
   'CNPJ e razão social não se editam por tela — quem muda isso é a Receita');

const areaVazia = await api('PUT', `/api/comercio/${L}/area`, { token: ger, corpo: { area: [] } });
ok(areaVazia.status === 422, 'área de entrega vazia é recusada');

const area = ['Centro', 'Jardim Primavera', 'Vila Nova', 'Bela Vista', 'Alto da Serra'];
await api('PUT', `/api/comercio/${L}/area`, { token: ger, corpo: { area: [...area, 'Monte Belo'] } });
const cfgApp = (await api('GET', '/api/config')).dados;
ok(cfgApp.area.includes('Monte Belo'), 'bairro novo já aparece no app do cliente na hora');
await api('PUT', `/api/comercio/${L}/area`, { token: ger, corpo: { area } });

const horarios = await api('PUT', `/api/comercio/${L}/horarios`, { token: ger, corpo: { dias: [
  { dia_semana: 0, abre: '09:00', fecha: '20:00' },
  { dia_semana: 1, is_24h: true }] } });
ok(horarios.status === 200 && horarios.dados.find((d) => d.dia_semana === 1)?.is_24h === 1,
   'horário por dia da semana, com 24h e fechado');

const deFora2 = await api('PUT', `/api/comercio/${L}`, { token: cli, corpo: { frete_centavos: 0 } });
ok(deFora2.status === 403, 'e ninguém de fora mexe no frete da casa');
console.log('\n' + (falhou === 0
  ? cor(32, `  ${passou} verificações passaram. A casa está sob controle.\n`)
  : cor(31, `  ${falhou} de ${passou + falhou} falharam.\n`)));
process.exitCode = falhou === 0 ? 0 : 1;
