import { qrSvg } from './qr.js';
import { embalagem, pictograma, pictogramaSintoma, CATS, IC, ABA } from './pkg.js';
import { marca, logotipo, sinal, abertura } from './marca.js';
import { criaMapa, progressoDoStatus } from './mapa.js';
import * as avisos from './avisos.js';

/* ============ estado ============ */
const S = {
  token: localStorage.getItem('sm_token') || null,
  eu: null, inicio: null, carrinho: carregaCarrinho(),
  rota: location.hash.slice(1) || 'inicio', filtro: 'generico',
  enderecoId: localStorage.getItem('sm_endereco') || null,
  naoLidas: 0, fechaAvisos: null,
  pagamento: localStorage.getItem('sm_pagamento') || 'pix',
  dados: {}, erro: null, ocupado: false, fonte: null,
};
function carregaCarrinho() {
  try { return JSON.parse(localStorage.getItem('sm_carrinho') || '{}'); } catch { return {}; }
}
function salvaCarrinho() {
  localStorage.setItem('sm_carrinho', JSON.stringify(S.carrinho));
}
const totalItens = () => Object.values(S.carrinho).reduce((a, b) => a + b, 0);

/* ============ api ============ */
async function api(metodo, caminho, corpo) {
  const res = await fetch(caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(dados.mensagem || 'Algo deu errado'), { code: dados.erro, status: res.status });
  return dados;
}

/* ============ formatação ============ */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function preco(centavos) {
  if (centavos == null) return '';
  const [i, d] = (centavos / 100).toFixed(2).split('.');
  return `R$ ${i}<small>,${d}</small>`;
}
const brl = (c) => 'R$ ' + ((c ?? 0) / 100).toFixed(2).replace('.', ',');
const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const relogio = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const ROTULO = {
  criado: 'recebido', aguardando_loja: 'na farmácia', aguardando_receita: 'com o farmacêutico',
  em_separacao: 'separando', aguardando_cliente: 'esperando você', pronto: 'pronto',
  em_rota: 'a caminho', entregue: 'entregue', cancelado: 'cancelado',
};

/* ============ blocos reutilizados ============ */
/**
 * Preço.
 * O selo sai do proprio dado, nao de etiqueta cadastrada a mao
 * dizendo isso em cima de cada card. O selo virou convite, e só aparece
 * para quem ainda não entrou.
 */
/**
 * O preço.
 *
 * Um preço só, igual para todo mundo. O clube foi embora: preço de sócio
 * cria duas verdades na mesma prateleira e obriga a pessoa a fazer conta
 * para saber quanto custa — que é exatamente o contrário do que farmácia
 * de bairro faz bem. O que sobra é o que importa: quanto é, e quanto
 * caiu em relação ao preço de tabela.
 */
function blocoPreco(p) {
  const paga = p.preco_final_centavos ?? p.preco_centavos;
  const tabela = p.preco_de_centavos ?? p.preco_centavos;
  const off = tabela > paga ? Math.round((1 - paga / tabela) * 100) : 0;

  return `<span class="preco">
    <span class="agora">${preco(paga)}</span>
    ${tabela > paga ? `<span class="antes"><s>${brl(tabela)}</s>${off ? `<b>−${off}%</b>` : ''}</span>` : ''}
  </span>`;
}

/**
 * O selo de campanha.
 *
 * Não é enfeite: é o que faz a pessoa entender em meio segundo por que
 * aquele preço está diferente. Sai do próprio dado — desconto grande é
 * "super oferta", genérico com corte é "desconto de laboratório" — para
 * ninguém precisar cadastrar etiqueta à mão e ela envelhecer mentindo.
 */
function seloDaOferta(p, off) {
  if (!off) return '';
  // o percentual mora AQUI, e só aqui. Antes existia também um chip
  // vermelho no canto da arte, e os dois brigavam pelo mesmo pedaço do
  // card: etiqueta em cima de etiqueta, dizendo a mesma coisa duas vezes
  if (off >= 25) return ['quente', `Super oferta · ${off}% off`];
  if (p.generico) return ['lab', `Laboratório · ${off}% off`];
  return ['normal', `Economize ${off}%`];
}

function cardProduto(p) {
  const off = p.preco_de_centavos && p.preco_de_centavos > p.preco_centavos
    ? Math.round((1 - p.preco_centavos / p.preco_de_centavos) * 100) : 0;
  const selo = seloDaOferta(p, off);
  return `
  <button class="prod${selo ? ' com-selo' : ''}" data-ir="produto/${p.ean}">
    ${selo ? `<span class="selo-campanha ${selo[0]}">${selo[1]}</span>` : ''}
    <span class="arte">${embalagem(p)}
      <span class="mais" data-add="${p.ean}" role="button" aria-label="Adicionar">${IC.mais}</span></span>
    <span class="info">
      <span class="nome">${esc(p.nome)}</span>
      <span class="ficha">${esc([p.generico ? 'genérico' : '', p.apresentacao].filter(Boolean).join(' · '))}</span>
      <span class="rodape">${blocoPreco(p)}</span>
    </span>
  </button>`;
}


/* ============ tela: início ============ */
function telaInicio() {
  const d = S.inicio;
  if (!d) return esqueletoInicio();
  const end = S.dados.enderecos?.find((e) => e.id === S.enderecoId) ?? d.endereco;
  const cont = d.continuos[0];
  const cats = d.categorias.filter((c) => CATS[c.categoria]).slice(0, 8);

  return `
  <div class="tela" id="tela"><div class="rolagem">
    <div class="capa">
      <div class="fila-marca">
        ${logotipo({ tam: 20 })}
        <button class="redondo" data-ir="avisos" aria-label="Avisos">${IC.sino}
          ${S.naoLidas ? `<span class="selo">${S.naoLidas > 9 ? '9+' : S.naoLidas}</span>` : ''}</button>
        <button class="redondo" data-ir="carrinho" aria-label="Carrinho">${IC.carrinho}
          ${totalItens() ? `<span class="selo">${totalItens()}</span>` : ''}</button>
      </div>
      <div class="local">
        <div class="txt">
          <div class="ola">${d.saudacao}${d.user ? ', ' + esc(d.user.nome.split(' ')[0]) : ''}</div>
          <button class="end" data-enderecos="1">Entregar em <b>${esc(end?.logradouro ?? 'escolher endereço')}${end?.numero ? ', ' + esc(end.numero) : ''}</b>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></button>
        </div>
      </div>
      <button class="busca" data-ir="busca">
        <span class="lupa">${IC.busca}</span>
        <span class="dica">Busque <b id="rodizio">dipirona</b><span class="cursor"></span></span>
      </button>
    </div>

    <div class="tira-loja">
      <span class="ponto-aberto"></span>
      <b>${esc(d.farmacia?.nome ?? 'Solmedic+')}</b>
      <span class="sep">·</span><span>aberta agora</span>
      <span class="sep">·</span><span class="prazo-loja">chega em 40 min</span>
    </div>

    ${cartaoLocalizacao(end)}

    <div class="secao"><h2>O que você está sentindo?</h2></div>
    <div class="trilho-sintomas escalona">
      ${(S.dados.sintomas ?? []).slice(0, 8).map((sm) => {
        const cor = corDoSintoma(sm.id, sm.icone);
        return `<button class="pilula-sintoma" data-sintoma="${esc(sm.id)}">
          <span class="ic" style="background:${cor}1F;color:${cor}">${pictogramaSintoma(sm.id, sm.icone)}</span>
          ${esc(sm.rotulo)}</button>`;
      }).join('')}
      <button class="pilula-sintoma outro" data-ir="conversa">
        <span class="ic" style="background:var(--wash);color:var(--brand)">${IC.balao}</span>
        Outra coisa? Pergunte</button>
    </div>

    ${d.armario?.recolhidos || d.armario?.vencendo || d.armario?.vencidos ? `
      <button class="andamento ${d.armario.recolhidos || d.armario.vencidos ? 'urgente' : 'atencao'}"
        data-ir="armario">
        <span class="pulso"></span>
        <span class="tx"><b>${d.armario.recolhidos
          ? 'Um lote que você tem foi recolhido'
          : d.armario.vencidos ? 'Tem remédio vencido no seu armário'
          : `${d.armario.vencendo} ${d.armario.vencendo === 1 ? 'item vencendo' : 'itens vencendo'}`}</b>
          <span>toque para ver o que fazer</span></span>
        ${IC.seta}
      </button>` : ''}

    ${d.a_avaliar && !d.pedido_em_andamento ? `
      <button class="andamento" data-ir="pedido/${d.a_avaliar.id}">
        <span class="pulso" style="background:#FFD98A"></span>
        <span class="tx"><b>Como foi o ${esc(d.a_avaliar.codigo)}?</b>
          <span>sua nota ajuda a gente a melhorar</span></span>
        ${IC.seta}
      </button>` : ''}

    ${cont ? `
      <div class="secao"><h2>Continuar tratamento</h2></div>
      <div class="continuo">
        <span class="arte">${embalagem(cont, { perto: true })}</span>
        <span class="tx">
          <span class="tag">${IC.receita.replace('21','12').replace('21','12')} receita com saldo</span>
          <h3>${esc(cont.nome)}</h3>
          <div class="sub">${esc(cont.apresentacao ?? '')}</div>
          <div class="saldo">${Array.from({ length: cont.qtd_prescrita }, (_, i) =>
            `<i class="${i < cont.saldo ? 'tem' : ''}"></i>`).join('')}
            <span>${cont.saldo} de ${cont.qtd_prescrita} caixas</span></div>
          <button class="cta" data-add="${cont.ean}">${IC.mais} Pedir de novo<b style="font-weight:700;opacity:.8">${brl(cont.preco_centavos)}</b></button>
        </span>
      </div>` : ''}

    ${/*
        A grade de categorias saiu daqui.
        Oito quadradinhos ocupavam meia tela da home para dizer o que a
        farmácia vende — informação que a pessoa já sabe. Quem chega na
        home quer resolver um sintoma ou repetir uma compra; quem quer
        navegar por prateleira está na busca, e é lá que a grade mora
        agora, atrás de um botão.
      */''}

    ${d.ofertas.length ? `
      <div class="secao"><h2>Ofertas de hoje</h2><span class="mais" data-ir="busca">ver tudo</span></div>
      <div class="trilho escalona">${d.ofertas.map(cardProduto).join('')}</div>` : ''}

    ${barraFarmaceutico()}

    ${d.recomprar.length ? `
      <div class="secao" style="margin-top:22px"><h2>Você já comprou</h2></div>
      <div class="trilho">${d.recomprar.map(cardProduto).join('')}</div>` : ''}

    <div class="secao"><h2>A farmácia</h2><span class="nota">é a nossa</span></div>
    <button class="cartao-loja" data-ir="conta">
      <span class="lg">${marca({ tam: 42 })}</span>
      <span class="tx"><b>${esc(d.farmacia?.nome ?? 'Solmedic+')}</b>
        <span>${esc(d.farmacia?.bairro ?? '')} · aberta agora · entrega em 40 min</span></span>
      <span class="ponto"></span>
    </button>
    ${d.fora_da_area ? `
      <div class="caixa-aviso a-hot" style="margin:14px 18px 0">
        <h4>Ainda não chegamos aí</h4>
        Seu endereço está em ${esc(d.endereco?.bairro ?? '')}, fora da nossa área.
        Hoje entregamos em ${(d.area ?? []).join(', ')}.
      </div>` : `
      <p class="nota-area" style="margin:12px 18px 0">
        Entregamos em ${(d.area ?? []).join(', ')}. Cresce conforme a moto dá conta.</p>`}
  </div></div>`;
}

function esqueletoInicio() {
  return `<div class="tela"><div class="rolagem">
    <div class="capa">
      <div class="local"><div class="txt">
        <div class="esqueleto" style="height:23px;width:58%;margin-bottom:8px"></div>
        <div class="esqueleto" style="height:13px;width:76%"></div></div></div>
      <div class="esqueleto" style="height:54px;border-radius:16px;margin:12px 0 16px"></div></div>
    <div class="secao"><div class="esqueleto" style="height:18px;width:140px"></div></div>
    <div style="padding:0 18px"><div class="esqueleto" style="height:112px;border-radius:18px"></div></div>
    <div class="secao"><div class="esqueleto" style="height:18px;width:110px"></div></div>
    <div class="grade-cat">${Array.from({ length: 8 }, () =>
      '<div class="esqueleto" style="height:74px"></div>').join('')}</div>
    <div class="secao"><div class="esqueleto" style="height:18px;width:130px"></div></div>
    <div class="trilho">${Array.from({ length: 3 }, () =>
      '<div class="esqueleto" style="height:230px;width:156px;flex:none;border-radius:18px"></div>').join('')}</div>
  </div></div>`;
}

/* ============ tela: busca ============ */
/** Filtros de verdade: cada um muda a lista. Controle decorativo é ruído. */
const FILTROS = [
  { id: 'generico', rotulo: 'Genérico primeiro',
    ordena: (a, b) => (b.generico - a.generico) || (a.menor_preco_centavos - b.menor_preco_centavos) },
  { id: 'preco', rotulo: 'Menor preço',
    ordena: (a, b) => a.menor_preco_centavos - b.menor_preco_centavos },
  { id: 'so_generico', rotulo: 'Só genéricos', filtra: (p) => p.generico === 1 },
  { id: 'sem_receita', rotulo: 'Sem receita', filtra: (p) => !p.requer_receita },
];

function aplicaFiltro(itens) {
  const f = FILTROS.find((x) => x.id === S.filtro) || FILTROS[0];
  const lista = f.filtra ? itens.filter(f.filtra) : [...itens];
  return f.ordena ? lista.sort(f.ordena) : lista;
}

function telaBusca() {
  const { q = '', carregando } = S.dados.busca || {};
  const itens = aplicaFiltro(S.dados.busca?.itens || []);
  return `
  <div class="tela"><div class="rolagem">
    <div class="cabeca">
      <button class="voltar" data-ir="inicio" aria-label="Voltar">${IC.volta}</button>
      <label class="campo">${IC.busca}
        <input id="q" value="${esc(q)}" placeholder="remédio, marca ou princípio ativo"
               autocomplete="off" enterkeyhint="search"></label>
      <button class="redondo" data-ir="carrinho" aria-label="Carrinho">${IC.carrinho}${totalItens() ? `<span class="selo">${totalItens()}</span>` : ''}</button>
    </div>
    <div class="filtros">
      <button class="filtro-cat ${S.catsAbertas ? 'on' : ''}" data-cats="1">
        <span class="pontinhos"><i></i><i></i><i></i><i></i></span>
        Categorias
      </button>
      ${FILTROS.map((f) => `<button class="filtro ${S.filtro === f.id ? 'on' : ''}"
        data-filtro="${f.id}">${f.rotulo}</button>`).join('')}
    </div>

    ${S.catsAbertas ? gradeCategorias() : ''}

    <div id="resultados">${carregando ? Array.from({ length: 3 }, () =>
        '<div class="esqueleto" style="height:100px;margin:0 18px 10px;border-radius:18px"></div>').join('')
      : !q ? `
          <div class="secao" style="margin:4px 18px 10px"><h2>O que você está sentindo?</h2></div>
          <div class="sintomas">${(S.dados.sintomas ?? []).map((sm) => {
            const [, cor] = CATS[sm.icone] ?? ['', 'var(--brand)'];
            return `<button class="sintoma" data-sintoma="${esc(sm.id)}">
              <span class="ic" style="background:${cor}1F;color:${cor}">${pictogramaSintoma(sm.id, sm.icone)}</span>
              ${esc(sm.rotulo)}</button>`;
          }).join('')}</div>
          <p class="nota-area" style="margin:14px 18px 0">
            Isto é uma prateleira, não uma indicação.
            <button class="perguntar" style="margin:8px 0 0" data-ir="conversa">Falar com o farmacêutico</button></p>`
      : !itens.length ? `<div class="vazio"><span class="emoji">∅</span>Nada encontrado para “${esc(q)}”.</div>`
      : `${S.dados.busca?.sintoma ? `
           <div class="faixa-sintoma">
             <b>${esc(S.dados.busca.sintoma.rotulo)}</b>
             <span>${esc(S.dados.busca.sintoma.ressalva)}</span>
           </div>` : ''}
         <div style="font-size:12.5px;color:var(--ink-3);padding:0 18px 12px">
           <b style="color:var(--ink-2)">${itens.length} ${itens.length === 1 ? 'resultado' : 'resultados'}.</b>
           Busca por princípio ativo — a marca mostra o genérico.</div>
         <div class="escalona">${itens.map(linhaAchado).join('')}</div>`}</div>
  </div></div>`;
}

function linhaAchado(p) {
  const rx = p.requer_receita;
  return `
  <button class="achado" data-ir="produto/${p.ean}">
    <span class="arte">${embalagem(p, { perto: true })}</span>
    <span class="tx">
      <span class="nome">${esc(p.nome)}</span>
      <span class="ficha">${esc([p.fabricante, p.generico ? 'genérico' : 'referência', p.apresentacao].filter(Boolean).join(' · '))}</span>
      <span class="tarja ${rx ? 't-rx' : 't-livre'}"><i></i>${rx ? 'precisa de receita' : 'venda livre'}</span>
      <span style="margin-top:7px">${blocoPreco({ ...p, preco_final_centavos: p.menor_preco_centavos, preco_centavos: p.menor_preco_centavos })}</span>
      ${p.economia_centavos > 0 ? `<span class="economia">↓ ${brl(p.economia_centavos)} mais barato no genérico</span>` : ''}
      ${p.pmc_centavos ? `<span class="pmc">PMC ${brl(p.pmc_centavos)} · ${p.lojas} ${p.lojas === 1 ? 'farmácia' : 'farmácias'}</span>` : ''}
    </span>
  </button>`;
}

/* ============ tela: produto ============ */
function telaProduto() {
  const p = S.dados.produto;
  if (!p) return `<div class="tela"><div class="rolagem">
    <div class="esqueleto" style="height:250px"></div>
    <div style="padding:20px"><div class="esqueleto" style="height:26px;width:70%;margin-bottom:14px"></div>
      <div class="esqueleto" style="height:44px;width:45%;margin-bottom:18px"></div>
      <div class="esqueleto" style="height:160px;border-radius:14px"></div></div></div></div>`;

  const oferta = p.ofertas?.[0];
  const rx = p.requer_receita;
  const noCarrinho = S.carrinho[p.ean] ?? 0;
  const dados = oferta ? {
    ...p, preco_centavos: oferta.preco_centavos,
    preco_final_centavos: oferta.preco_centavos,
    preco_de_centavos: oferta.preco_de_centavos,
  } : p;

  return `
  <div class="tela tela-produto"><div class="rolagem" style="padding-bottom:20px">
    <div class="barra-produto" id="barraProduto">
      <button class="acao-barra" data-ir="voltar" aria-label="Voltar">${IC.volta}</button>
      <span class="titulo-barra">${esc(p.nome)}</span>
      <button class="acao-barra" data-ir="carrinho" aria-label="Carrinho">${IC.carrinho}
        ${totalItens() ? `<span class="selo">${totalItens()}</span>` : ''}</button>
    </div>
    <div class="vitrine">${embalagem(p)}</div>

    <div class="corpo">
      <span class="tarja ${rx ? 't-rx' : 't-livre'}" style="margin:0"><i></i>${
        rx ? `tarja ${esc(p.tarja)}` : 'venda livre'}</span>
      <h1>${esc(p.nome)}</h1>
      <p class="linha-ficha">${esc([p.generico ? 'Genérico' : 'Referência', p.fabricante,
        p.apresentacao].filter(Boolean).join(' · '))}</p>

      ${oferta ? `
        <div class="preco-produto">
          <div class="valor">${preco(dados.preco_final_centavos)}</div>
          <div class="ao-lado">
            ${dados.preco_de_centavos && dados.preco_de_centavos > dados.preco_final_centavos ? `
              <span class="risco">${brl(dados.preco_de_centavos)}</span>
              <span class="corte">−${Math.round((1 - dados.preco_final_centavos / dados.preco_de_centavos) * 100)}%</span>`
              : ''}
            ${p.pmc_centavos ? `<span class="pmc-nota">teto CMED ${brl(p.pmc_centavos)}</span>` : ''}
          </div>
        </div>

        <div class="entrega-tira">
          <span class="item"><b>⚡ ${oferta.estoque > 0 ? 'Chega hoje' : 'Sem estoque'}</b>
            <span>${oferta.estoque > 0 ? '40 a 55 minutos' : 'avisamos quando voltar'}</span></span>
          <span class="risca"></span>
          <span class="item"><b>${oferta.frete_centavos ? brl(oferta.frete_centavos) : 'Frete grátis'}</b>
            <span>${oferta.frete_centavos ? 'grátis acima de R$ 50' : 'neste pedido'}</span></span>
        </div>`
        : '<div class="vazio" style="padding:30px 0">Este item não está disponível agora.</div>'}

      ${p.generico_equivalente ? `
        <button class="cartao-troca" data-ir="produto/${p.generico_equivalente.ean}">
          <span class="ic">${IC.troca}</span>
          <span class="tx"><b>Existe genérico equivalente</b>
            <span>${esc(p.generico_equivalente.nome)} por ${brl(p.generico_equivalente.preco_centavos)} — mesmo princípio ativo, mesma dosagem</span></span>
          ${IC.seta}
        </button>` : ''}
      ${p.generico && p.referencia && p.economia_vs_referencia > 0 ? `
        <div class="cartao-troca informativo">
          <span class="ic">${IC.troca}</span>
          <span class="tx"><b>Você está no genérico</b>
            <span>${brl(p.economia_vs_referencia)} mais barato que ${esc(p.referencia.nome)}, com o mesmo ${esc(p.principio_ativo ?? 'princípio ativo')}</span></span>
        </div>` : ''}

      ${rx ? `<div class="caixa-aviso a-rx" style="margin-top:16px">
        <h4>℞ Precisa de receita</h4>
        Um farmacêutico confere a receita antes da separação, e o cartão só é cobrado depois disso.</div>` : ''}
      ${p.refrigerado ? `<div class="caixa-aviso a-hot" style="margin-top:12px">
        <h4>❄ Cadeia fria</h4>
        Sai em caixa térmica e precisa ser recebido em mãos.</div>` : ''}

      <div class="secao" style="margin:24px 0 10px"><h2>A ficha do produto</h2></div>
      <div class="ficha-tec">
        ${[['Princípio ativo', p.principio_ativo], ['Dosagem', p.dosagem],
           ['Apresentação', p.apresentacao], ['Fabricante', p.fabricante],
           ['Tipo', p.generico ? 'Genérico' : 'Referência'],
           ['Registro MS', p.registro_ms], ['Código de barras', p.ean]]
          .filter(([, v]) => v).map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('')}
      </div>

      <button class="cartao-farma" style="margin:16px 0 0;width:100%" data-pergunta="Dúvida sobre ${esc(p.nome)}: ">
        <span class="retrato-farma">${IC.balao}</span>
        <span class="tx"><b>Dúvida sobre este remédio?</b>
          <span>Dose, interação, se pode tomar junto. Responde gente com CRF.</span></span>
        ${IC.seta}
      </button>

      <a class="linha-bula" href="https://consultas.anvisa.gov.br/#/bulario/" target="_blank" rel="noopener">
        <span class="ic">${IC.receita}</span>
        <span class="tx"><b>Bula completa</b><span>Como tomar, efeitos e contraindicações · Anvisa</span></span>
        ${IC.seta}
      </a>

      ${avisosLegais(p).map((a) => `
        <div class="aviso-ms">
          <span class="ic">${IC.info ?? '!'}</span>
          <span class="tx"><b>${a.titulo}</b>${esc(a.texto)}</span>
        </div>`).join('')}

      <p class="rodape-legal">
        Vendido por ${esc(S.dados.vitrine?.nome_fantasia ?? S.inicio?.farmacia?.nome ?? 'Solmedic+')}${S.dados.vitrine?.cnpj ? `, CNPJ ${esc(S.dados.vitrine.cnpj)}` : ''}.
        ${S.dados.vitrine?.responsavel_tecnico ? `Responsável técnico ${esc(S.dados.vitrine.responsavel_tecnico.nome)} · ${esc(S.dados.vitrine.responsavel_tecnico.crf)}.` : ''}
      </p>
    </div>
  </div>

  ${oferta && oferta.estoque > 0 ? `
    <div class="barra-comprar">
      ${noCarrinho ? `
        <span class="contador grande">
          <button data-qtd="${p.ean}:-1" aria-label="Menos">−</button>
          <span>${noCarrinho}</span>
          <button data-qtd="${p.ean}:1" aria-label="Mais">+</button>
        </span>
        <button class="botao-grande" style="flex:1" data-ir="carrinho">Ver carrinho · ${brl(dados.preco_final_centavos * noCarrinho)}</button>`
      : `<button class="botao-grande" style="flex:1" data-add="${p.ean}">${IC.mais} Adicionar · ${brl(dados.preco_final_centavos)}</button>`}
    </div>` : ''}
  </div>`;
}

/* ============ tela: carrinho ============ */
function telaCarrinho() {
  const o = S.dados.orcamento;
  if (!totalItens()) return `<div class="tela"><div class="rolagem">
    <div class="cabeca"><button class="voltar" data-ir="inicio">${IC.volta}</button><h1>Carrinho</h1></div>
    <div class="vazio"><span class="emoji">🛒</span>Seu carrinho está vazio.<br>
      <button style="color:var(--brand);font-weight:700;margin-top:10px" data-ir="busca">Buscar um remédio</button></div>
  </div></div>`;

  if (!o) return `<div class="tela"><div class="rolagem">
    <div class="cabeca"><button class="voltar" data-ir="inicio">${IC.volta}</button><h1>Carrinho</h1></div>
    <div class="esqueleto" style="height:150px;margin:0 18px;border-radius:18px"></div></div></div>`;

  const grupo = (titulo, itens, cls, prazo) => !itens.length ? '' : `
    <div class="grupo ${cls}">
      <div class="topo-g">${cls === 'rx' ? '℞' : '⚡'} ${titulo}<span class="prazo">${prazo}</span></div>
      ${itens.map((i) => `
        <div class="item-c">
          <span class="arte">${embalagem(i, { perto: true })}</span>
          <span class="tx"><b>${esc(i.nome)}</b>
            <span>${esc(i.dosagem ?? '')}${i.em_falta ? ' · SEM ESTOQUE' : ''}</span></span>
          <span class="contador">
            <button data-qtd="${i.ean}:-1" aria-label="Menos">−</button>
            <span>${i.qtd}</span>
            <button data-qtd="${i.ean}:1" aria-label="Mais">+</button></span>
          <span style="font-family:var(--mono);font-size:13px;font-weight:600">${brl(i.preco_total_centavos)}</span>
        </div>`).join('')}
    </div>`;

  return `
  <div class="tela"><div class="rolagem">
    <div class="cabeca"><button class="voltar" data-ir="inicio">${IC.volta}</button>
      <h1>Carrinho · ${totalItens()} ${totalItens() === 1 ? 'item' : 'itens'}</h1></div>
    <p style="font-size:12.5px;color:var(--ink-3);padding:0 18px 12px;margin:0">
      ${esc(o.pharmacy.nome)} · ${o.exige_receita
        ? 'Seu pedido sai em duas partes. Nada espera pelo outro.'
        : 'Tudo sai na mesma entrega.'}</p>
    ${S.erro ? `<div class="erro-caixa">${esc(S.erro)}</div>` : ''}
    ${grupo('Sai agora', o.grupos.sai_agora, '', 'hoje, 40 min')}
    ${grupo('Aguarda o farmacêutico', o.grupos.aguarda_farmaceutico, 'rx', '~4 min')}
    ${(o.alertas ?? []).map((a) => `
      <div class="alerta-conferencia ${a.nivel}">
        <span class="ic">⚠</span>
        <span class="tx"><b>${esc(a.titulo)}</b><span>${esc(a.texto)}</span>
          <button class="perguntar" data-pergunta="${esc(a.texto)} Posso levar os dois?">
            Perguntar ao farmacêutico</button></span>
      </div>`).join('')}

    <div class="secao" style="margin:22px 18px 10px"><h2>Como pagar</h2></div>
    <div class="formas">
      <button class="forma ${S.pagamento === 'pix' ? 'on' : ''}" data-forma="pix">
        <span class="ic">${IC.pix}</span>
        <span class="tx"><b>PIX</b><span>Confirma na hora</span></span>
        <span class="marca-forma"></span>
      </button>
      <button class="forma ${S.pagamento === 'cartao' ? 'on' : ''}" data-forma="cartao">
        <span class="ic">${IC.cartao}</span>
        <span class="tx"><b>Cartão final 4417</b>
          <span>${o.exige_receita ? 'Reserva agora, cobra depois da liberação' : 'Cobrado na separação'}</span></span>
        <span class="marca-forma"></span>
      </button>
    </div>

    <div class="somas">
      <div class="soma"><span>Produtos</span><b>${brl(o.subtotal_centavos)}</b></div>
      <div class="soma"><span>Entrega</span><b${o.frete_centavos ? '' : ' style="color:var(--save)"'}>${o.frete_centavos ? brl(o.frete_centavos) : 'Grátis'}</b></div>
      ${o.economia_centavos ? `<div class="soma eco"><span>Você economizou</span><b>− ${brl(o.economia_centavos)}</b></div>` : ''}
      <div class="soma total"><span>Total</span><b>${brl(o.total_centavos)}</b></div>
    </div>
    ${o.exige_receita ? `<div class="caixa-aviso a-rx" style="margin:14px 18px 0">
      <h4>Autorização, não cobrança</h4>
      Reservamos ${brl(o.total_centavos)} no cartão. A cobrança só acontece depois que o farmacêutico liberar.
      Se ele recusar, o valor volta sozinho.</div>` : ''}
    <div class="barra-fixa">
      <button class="botao-grande" data-fechar="1" ${S.ocupado ? 'disabled' : ''}>
        ${S.ocupado ? 'Enviando…' : `Finalizar pedido · ${brl(o.total_centavos)}`}</button>
    </div>
  </div></div>`;
}

/* ============ tela: receitas ============ */
function telaReceitas() {
  const lista = S.dados.receitas;
  return `
  <div class="tela"><div class="rolagem">
    <div class="cabeca"><h1>Minhas receitas</h1><button class="redondo" data-ir="carrinho" aria-label="Carrinho">${IC.carrinho}${totalItens() ? `<span class="selo">${totalItens()}</span>` : ''}</button></div>
    <p style="font-size:13px;color:var(--ink-2);padding:0 18px 14px;margin:0;line-height:1.5">
      A receita fica guardada com saldo. Você não precisa reenviar a cada compra.</p>
    ${S.erro ? `<div class="erro-caixa">${esc(S.erro)}</div>` : ''}
    ${!lista ? '<div class="esqueleto" style="height:140px;margin:0 18px;border-radius:18px"></div>'
      : lista.map(cartaoReceita).join('')}
    <div class="enviar" style="margin-top:14px">
      <div class="camera">${IC.camera}</div>
      <h4>Enviar nova receita</h4>
      <p>Foto do papel inteiro, com boa luz. O carimbo e o CRM precisam aparecer.</p>
      <input type="file" id="arquivo" accept="image/*,application/pdf" hidden>
      <button class="botao-grande" style="margin-top:14px;height:48px" data-enviar="1"
        ${S.ocupado ? 'disabled' : ''}>${S.ocupado ? 'Enviando…' : 'Escolher foto'}</button>
    </div>
    <p style="font-size:11.5px;color:var(--ink-3);padding:14px 18px 0;margin:0;line-height:1.6">
      Receita de controle especial (tarja preta) não é aceita por aqui — é preciso ir à farmácia.<br>
      Só você e o farmacêutico da loja enxergam essa imagem, e todo acesso fica registrado.</p>
  </div></div>`;
}

function cartaoReceita(r) {
  const pe = r.status === 'validada' ? ['ok', '✓', `Validada por ${esc(r.validada_crf ?? '')}`]
    : r.status === 'recusada' ? ['negado', '✕', `Recusada: ${esc(r.motivo_recusa ?? '')}`]
    : ['esperando', '◷', 'Na fila do farmacêutico · costuma levar 4 min'];
  const semLeitura = !r.itens.length;
  const titulo = semLeitura ? 'Receita enviada'
    : r.itens.map((i) => i.principio_ativo || i.ean).join(', ');
  const assinatura = [r.prescritor_nome, r.prescritor_crm ? `CRM-${r.prescritor_uf ?? ''} ${r.prescritor_crm}` : null,
    r.emitida_em].filter(Boolean).join(' · ');
  return `
  <div class="cartao">
    <div class="cab" style="display:flex;gap:12px;align-items:center">
      <span class="miniatura">${IC.receita}
        ${r.arquivo_url ? `<img src="${esc(r.arquivo_url)}" alt="" onerror="this.remove()">` : ''}</span>
      <div style="flex:1;min-width:0">
        <h3>${esc(titulo)}</h3>
        <p>${esc(assinatura || 'o farmacêutico ainda vai ler os dados do papel')}</p>
      </div>
    </div>
    <div class="meio">
      ${r.itens.map((i) => `
        <div style="margin-bottom:8px">
          <b style="color:var(--ink)">${esc(i.dosagem ?? '')}</b> ${esc(i.posologia ?? '')}
          <div class="saldo" style="display:flex;gap:4px;margin-top:7px;align-items:center">
            ${Array.from({ length: i.qtd_prescrita }, (_, k) =>
              `<i style="width:20px;height:5px;border-radius:2px;background:${k < i.saldo ? 'var(--brand)' : 'var(--surface-3)'}"></i>`).join('')}
            <span style="font-size:11.5px;color:var(--ink-2);margin-left:4px">${i.saldo} de ${i.qtd_prescrita}</span>
          </div>
        </div>`).join('')}
      ${semLeitura ? `<div style="font-size:12.5px;color:var(--ink-3);line-height:1.5">
        Assim que o farmacêutico abrir a foto, ele preenche o medicamento, a dose e a quantidade —
        e a receita passa a ter saldo.</div>` : ''}
      ${r.valida_ate ? `<div style="font-size:11.5px;color:var(--ink-3);margin-top:4px">Válida até ${esc(r.valida_ate)}</div>` : ''}
    </div>
    <div class="pe ${pe[0]}"><b>${pe[1]}</b> ${pe[2]}</div>
  </div>`;
}

/* ============ tela: pedido ============ */
const ORDEM = ['criado', 'aguardando_loja', 'aguardando_receita', 'em_separacao', 'pronto', 'em_rota', 'entregue'];

function telaPedido() {
  const p = S.dados.pedido;
  if (!p) return `<div class="tela tela-rastreio"><div class="mapa"></div>
    <div class="folha-rastreio" style="--folha-alt:62%"><div class="alca"><i></i></div>
      <div class="conteudo"><div class="esqueleto" style="height:40px;margin:8px 0 14px"></div>
        <div class="esqueleto" style="height:70px;margin-bottom:14px"></div>
        <div class="esqueleto" style="height:150px"></div></div></div></div>`;

  const eventos = p.linha_do_tempo ?? [];
  const atual = ORDEM.indexOf(p.status);
  const passos = [
    ['criado', 'Pedido recebido', 'A farmácia foi avisada'],
    [p.tem_receita ? 'aguardando_receita' : 'aguardando_loja',
     p.tem_receita ? 'Receita com o farmacêutico' : 'Confirmado pela farmácia',
     p.tem_receita ? 'Só ele pode liberar o item com tarja' : 'Separando os itens'],
    ['em_separacao', 'Separando e conferindo', 'Cada caixa é bipada: lote e validade'],
    ['em_rota', 'A caminho', 'Acompanhe pelo mapa'],
    ['entregue', p.entrega?.exige_maos ? 'Entrega em mãos' : 'Entregue',
     p.entrega?.exige_maos ? 'Precisa de alguém para receber' : ''],
  ];
  const oferta = p.ofertas?.[0];
  const entregador = p.entregador ?? null;

  return `
  <div class="tela tela-rastreio">
    <div class="mapa" id="mapa"></div>
    <div class="mapa-topo">
      <button class="voltar" data-ir="pedidos" aria-label="Voltar">${IC.volta}</button>
      <div><div class="titulo">${esc(p.codigo)}</div>
        <div class="sub">${esc(p.farmacia?.nome_fantasia ?? '')}</div></div>
    </div>

    <div class="folha-rastreio" id="folha" style="--folha-alt:${p.status === 'entregue' && !p.avaliacao ? '88%' : p.status === 'em_rota' ? '52%' : '62%'}">
      <div class="alca" id="alca"><i></i></div>
      <div class="conteudo">
        ${blocoAvaliacao(p)}
        <div class="chegada">
          <div>
            <div class="rot">${p.status === 'entregue' ? 'entregue' : p.status === 'cancelado' ? 'cancelado' : 'chega até'}</div>
            <div class="valor">${etaDoPedido(p)}</div>
          </div>
          <span class="estado"><span class="pilula ${p.status === 'entregue' ? 'ok'
            : p.status === 'cancelado' ? 'quente' : p.status === 'aguardando_receita' ? 'rx' : ''}">
            ${ROTULO[p.status] ?? p.status}</span></span>
        </div>

        ${p.pagamento?.metodo === 'pix' && p.pagamento?.status !== 'capturado' ? `
          <div class="painel-pix" style="margin:14px 0">
            <div class="cab"><span class="ic">${IC.pix}</span>
              <div><b>Pague com PIX · ${brl(p.total_centavos)}</b>
                <span>Copie o código e cole no seu banco</span></div></div>
            ${S.dados.pix?.copia_e_cola ? `
              <div class="quadro-pix">${qrSvg(S.dados.pix.copia_e_cola, { tam: 208 })}</div>
              <div class="valor-pix">${brl(S.dados.pix.valor_centavos ?? p.total_centavos)}
                <span>produtos + entrega</span></div>
              <div class="codigo-pix">${esc(S.dados.pix.copia_e_cola)}</div>
              <div class="pix-acoes">
                <button class="botao-grande" style="flex:1;height:46px;font-size:14px"
                  data-copiar="${esc(S.dados.pix.copia_e_cola)}">${IC.copia} Copiar código</button>
                <button class="botao-grande claro" style="flex:1;height:46px;font-size:14px"
                  data-pix="pagar:${p.id}">Já paguei</button>
              </div>`
              : `<div class="pix-acoes"><button class="botao-grande" style="flex:1;height:46px;font-size:14px"
                  data-pix="gerar:${p.id}">Gerar código PIX</button></div>`}
          </div>` : ''}
        ${p.pagamento?.metodo === 'pix' && p.pagamento?.status === 'capturado' ? `
          <div class="painel-pix" style="margin:14px 0"><div class="pix-pago">✓ PIX confirmado · ${brl(p.pagamento.valor_capturado_centavos)}</div></div>` : ''}

        ${p.exige_coleta_receita && !p.receita_retida ? `
          <div class="caixa-aviso a-rx" style="margin-top:14px">
            <h4>℞ Separe a via da receita</h4>
            Este pedido tem item com retenção obrigatória. Entregue a via ao motoboy —
            ela precisa voltar para a farmácia, e é isso que fecha a dispensação.
          </div>` : ''}

        ${oferta ? `<div class="caixa-aviso a-hot" style="margin-top:14px">
          <h4>${IC.troca} Faltou um item</h4>
          A farmácia ofereceu <b>${esc(oferta.nome_oferecido)}</b> por ${brl(oferta.preco_centavos)}
          (${oferta.diferenca_centavos >= 0 ? '+' : '−'} ${brl(Math.abs(oferta.diferenca_centavos))}).
          <div style="display:flex;gap:8px;margin-top:11px">
            <button class="botao-grande" style="height:42px;font-size:13px;flex:1"
              data-oferta="${oferta.id}:1">Aceitar a troca</button>
            <button class="botao-grande claro" style="height:42px;font-size:13px;flex:1"
              data-oferta="${oferta.id}:0">Só estornar</button></div></div>` : ''}

        ${entregador && ['em_rota', 'entregue'].includes(p.status) ? `
          <div class="entregador">
            <span class="retrato">${esc(iniciais(entregador.nome))}</span>
            <span class="quem"><b>${esc(entregador.nome)}</b>
              <span>${esc(entregador.veiculo ?? 'moto')} · entregador da farmácia</span>
              ${entregador.placa ? `<span class="placa">${esc(entregador.placa)}</span>` : ''}</span>
            <button class="acao-redonda" aria-label="Ligar">${IC.telefone}</button>
            <button class="acao-redonda cheia" aria-label="Mensagem">${IC.balao}</button>
          </div>` : ''}

        <div class="passos" style="margin:16px 0 0;padding-left:28px">${passos.map(([st, texto, ajuda]) => {
          const i = ORDEM.indexOf(st);
          const ev = eventos.find((e) => e.status === st);
          const cls = p.status === 'cancelado' ? '' : i < atual ? 'feito' : i === atual ? 'agora' : '';
          return `<div class="passo ${cls}"><b>${texto}</b>
            ${ev ? `<span>${hora(ev.criado_em)}${ev.ator_nome ? ' · ' + esc(ev.ator_nome) : ''}</span>`
                 : ajuda ? `<span>${ajuda}</span>` : ''}</div>`;
        }).join('')}</div>

        <div class="grupo" style="margin:6px 0 0">
          <div class="topo-g">Itens<span class="prazo">${p.itens.length}</span></div>
          ${p.itens.map((i) => `
            <div class="item-c">
              <span class="tx"><b>${esc(i.nome_snapshot)}</b>
                <span>${i.qtd}×${i.lote ? ' · lote ' + esc(i.lote) : ''}${i.status === 'indisponivel' ? ' · em falta' : ''}</span></span>
              <span style="font-family:var(--mono);font-size:13px;font-weight:600">${brl(i.preco_total_centavos)}</span>
            </div>`).join('')}
        </div>

        <div class="somas" style="margin:14px 0 0">
          <div class="soma"><span>Produtos</span><b>${brl(p.subtotal_centavos)}</b></div>
          <div class="soma"><span>Entrega</span><b>${p.frete_centavos ? brl(p.frete_centavos) : 'Grátis'}</b></div>
          <div class="soma total"><span>${p.pagamento?.status === 'capturado' ? 'Cobrado' : 'Autorizado'}</span>
            <b>${brl(p.total_centavos)}</b></div>
          <div style="font-size:11.5px;color:var(--ink-3);margin-top:8px;line-height:1.5">
            ${p.pagamento?.status === 'autorizado'
              ? `Reservado no cartão final ${esc(p.pagamento.cartao_final ?? '')}. Ainda não foi cobrado.`
              : p.pagamento?.status === 'estornado' ? 'Autorização estornada — nada foi cobrado.'
              : `Cobrado no cartão final ${esc(p.pagamento?.cartao_final ?? '')}.`}</div>
        </div>

        <div style="font-size:11.5px;color:var(--ink-3);padding:16px 0 0;line-height:1.6">
          Quem vende é ${esc(p.farmacia?.nome_fantasia ?? '')}, CNPJ ${esc(p.farmacia?.cnpj ?? '')}.
          ${S.dados.vitrine?.responsavel_tecnico
            ? `Responsável técnico ${esc(S.dados.vitrine.responsavel_tecnico.nome)} · ${esc(S.dados.vitrine.responsavel_tecnico.crf)}.` : ''}
          ${S.dados.vitrine?.telefone ? `Telefone ${esc(S.dados.vitrine.telefone)}.` : ''}
        </div>

        ${['criado', 'aguardando_loja', 'aguardando_receita'].includes(p.status) ? `
          <button class="botao-grande claro" style="margin-top:18px"
            data-cancelar="${p.id}">Cancelar pedido</button>` : ''}
      </div>
    </div>
  </div>`;
}

/** Avaliação: só aparece quando o pedido chegou e ainda não foi avaliado. */
function blocoAvaliacao(p) {
  if (p.status !== 'entregue') return '';
  if (p.avaliacao) {
    return `
      <div class="obrigado">
        <div class="marca-ok">${IC.estrela.replace('30', '26').replace('30', '26')}</div>
        <h3>Obrigado</h3>
        <p>Sua nota vai para a ${esc(p.farmacia?.nome_fantasia ?? 'farmácia')} e para o entregador.
          É assim que a gente sabe quem está cuidando bem de você.</p>
        <div class="nota-dada">${Array.from({ length: p.avaliacao.nota }, () =>
          IC.estrela.replace('30', '17').replace('30', '17')).join('')}</div>
        <button class="botao-grande" style="margin-top:18px" data-ir="inicio">Pedir de novo</button>
      </div>`;
  }
  const nota = S.dados.nota ?? 0;
  const escolhidas = S.dados.marcasEscolhidas ?? [];
  const lista = nota && nota <= 3 ? (S.dados.marcas?.ruim ?? []) : (S.dados.marcas?.bom ?? []);
  return `
    <div class="avaliacao">
      <h3>Como foi?</h3>
      <p>${esc(p.farmacia?.nome_fantasia ?? '')}${p.entregador ? ' · ' + esc(p.entregador.nome) : ''}</p>
      <div class="estrelas">${[1, 2, 3, 4, 5].map((n) => `
        <button class="estrela ${n <= nota ? 'acesa' : ''}" data-nota="${n}"
          aria-label="${n} estrela${n > 1 ? 's' : ''}">${IC.estrela}</button>`).join('')}</div>
      ${nota ? `
        <div class="marcas">${lista.map((m) => `
          <button class="marcaBtn ${escolhidas.includes(m) ? 'on' : ''}" data-marca="${esc(m)}">${esc(m)}</button>`).join('')}</div>
        ${nota <= 3 ? `<textarea class="campoTexto" id="comentario"
          placeholder="O que deu errado? A farmácia lê isso."></textarea>` : ''}
        <button class="botao-grande" data-avaliar="${p.id}">Enviar avaliação</button>` : ''}
    </div>`;
}

const avisosBloqueados = () => avisos.estadoDaPermissao() === 'denied';

const iniciais = (nome) => String(nome || '?').split(/\s+/).slice(0, 2)
  .map((n) => n[0]).join('').toUpperCase();

/** Horário de chegada, do jeito que a pessoa lê no relógio. */
function etaDoPedido(p) {
  if (p.status === 'entregue' && p.entregue_em) return hora(p.entregue_em);
  if (p.status === 'cancelado') return '—';
  const base = p.despachado_em ? Date.parse(p.despachado_em) + 14 * 60000
    : Date.parse(p.criado_em) + 42 * 60000;
  return new Date(base).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/* ============ tela: lista de pedidos ============ */
function telaPedidos() {
  const lista = S.dados.pedidos;
  return `
  <div class="tela"><div class="rolagem">
    <div class="cabeca"><h1>Meus pedidos</h1><button class="redondo" data-ir="carrinho" aria-label="Carrinho">${IC.carrinho}${totalItens() ? `<span class="selo">${totalItens()}</span>` : ''}</button></div>
    ${!lista ? '<div class="esqueleto" style="height:80px;margin:0 18px;border-radius:18px"></div>'
      : !lista.length ? `<div class="vazio"><span class="emoji">📦</span>Você ainda não fez nenhum pedido.</div>`
      : lista.map((p) => `
        <button class="cartao" style="display:block;width:calc(100% - 36px);text-align:left" data-ir="pedido/${p.id}">
          <div class="cab" style="display:flex;align-items:center;gap:12px;border-bottom:0">
            <div style="flex:1">
              <h3>${esc(p.codigo)}</h3>
              <p>${new Date(p.criado_em).toLocaleDateString('pt-BR')} · ${hora(p.criado_em)}</p>
            </div>
            <span class="tarja ${p.status === 'entregue' ? 't-livre' : 't-rx'}" style="margin:0"><i></i>${ROTULO[p.status] ?? p.status}</span>
            <b style="font-family:var(--mono);font-size:14px">${brl(p.total_centavos)}</b>
          </div>
        </button>`).join('')}
  </div></div>`;
}

/* ============ tela: avisos ============ */
function telaAvisos() {
  const lista = S.dados.notificacoes;
  const quando = (iso) => {
    const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    if (min < 1440) return `há ${Math.round(min / 60)} h`;
    return new Date(iso).toLocaleDateString('pt-BR');
  };
  return `
  <div class="tela"><div class="rolagem">
    <div class="cabeca"><button class="voltar" data-ir="voltar">${IC.volta}</button><h1>Avisos</h1></div>
    ${!lista ? '<div class="esqueleto" style="height:90px;margin:0 18px;border-radius:18px"></div>'
      : !lista.length ? `<div class="vazio"><span class="emoji">🔔</span>
          Nada por aqui ainda.<br>A gente avisa quando seu pedido andar.</div>`
      : `<div class="lista-avisos escalona">${lista.map((n) => `
          <button class="aviso-item ${n.lida_em ? '' : 'nova'}" data-ir="${esc((n.url ?? '/#inicio').replace('/#', ''))}">
            <span class="ponto-aviso"></span>
            <span class="tx"><b>${esc(n.titulo)}</b><span>${esc(n.corpo ?? '')}</span></span>
            <span class="quando">${quando(n.criado_em)}</span>
          </button>`).join('')}</div>`}
  </div></div>`;
}

/* ============ tela: falar com o farmacêutico ============ */
function telaConversa() {
  const c = S.dados.conversa;
  if (!c) return `<div class="tela"><div class="rolagem">
    <div class="cabeca"><button class="voltar" data-ir="voltar">${IC.volta}</button><h1>Farmacêutico</h1></div>
    <div class="esqueleto" style="height:60px;margin:0 18px 10px;border-radius:16px"></div>
    <div class="esqueleto" style="height:60px;margin:0 18px;border-radius:16px"></div></div></div>`;

  const hoje = new Date().toDateString();
  return `
  <div class="tela tela-conversa"><div class="rolagem conversa-rolagem" id="fio">
    <div class="cabeca">
      <button class="voltar" data-ir="voltar">${IC.volta}</button>
      <div style="flex:1;min-width:0">
        <h1 style="font-size:19px">Farmacêutico</h1>
        <div class="estado-farma">${c.status === 'aberta'
          ? '<span class="bolinha"></span> respondendo agora'
          : '<span class="bolinha respondida"></span> respondido'}</div>
      </div>
    </div>

    <div class="balões">
      ${c.mensagens.map((m) => {
        const dia = new Date(m.criado_em).toDateString();
        if (m.autor_tipo === 'sistema') {
          return `<div class="balao-sistema">${esc(m.texto)}</div>`;
        }
        const meu = m.autor_tipo === 'cliente';
        return `
        <div class="balao ${meu ? 'meu' : 'dele'}">
          ${!meu ? `<div class="quem">${esc(m.autor_nome ?? '')}
            ${m.crf ? `<span class="crf">${esc(m.crf)}</span>` : ''}</div>` : ''}
          <div class="texto">${esc(m.texto)}</div>
          <div class="hora-msg">${hora(m.criado_em)}${dia !== hoje
            ? ' · ' + new Date(m.criado_em).toLocaleDateString('pt-BR') : ''}</div>
        </div>`;
      }).join('')}
      ${c.status === 'aberta' && c.mensagens.some((m) => m.autor_tipo === 'cliente')
        ? '<div class="digitando"><i></i><i></i><i></i></div>' : ''}
    </div>

    ${c.mensagens.filter((m) => m.autor_tipo === 'cliente').length === 0 ? `
      <div class="atalhos">${(c.atalhos ?? []).map((a) => `
        <button class="atalho" data-pergunta="${esc(a)}">${esc(a)}</button>`).join('')}</div>` : ''}
  </div>

  <div class="escrever">
    <label class="campo-msg">
      <textarea id="msg" rows="1" placeholder="Escreva sua dúvida" enterkeyhint="send"></textarea>
    </label>
    <button class="enviar-msg" data-enviar-msg="1" aria-label="Enviar">${IC.seta}</button>
  </div>
  </div>`;
}

/* ============ tela: o armário da casa ============ */
function telaArmario() {
  const d = S.dados.armario;
  if (!d) return `<div class="tela"><div class="rolagem">
    <div class="cabeca"><button class="voltar" data-ir="voltar">${IC.volta}</button><h1>Seu armário</h1></div>
    ${[1, 2, 3].map(() => '<div class="esqueleto" style="height:92px;margin:0 18px 10px;border-radius:18px"></div>').join('')}
  </div></div>`;

  const { itens, resumo } = d;
  const urgentes = itens.filter((i) => i.estado === 'recolhido' || i.estado === 'vencido');
  const vencendo = itens.filter((i) => i.estado === 'vencendo');
  const ok = itens.filter((i) => i.estado === 'ok');

  const cartao = (i) => {
    const rot = {
      recolhido: ['recolhido', 'Pare de usar — lote recolhido'],
      vencido: ['vencido', `Venceu em ${esc(i.validade ?? '')}`],
      vencendo: ['vencendo', `Vence em ${i.dias_para_vencer} dias`],
      ok: ['ok', i.validade ? `Vence em ${esc(i.validade)}` : 'Sem validade registrada'],
    }[i.estado];
    return `
    <div class="item-armario ${rot[0]}">
      <span class="arte">${embalagem(i, { perto: true })}</span>
      <span class="tx">
        <b>${esc(i.nome)}</b>
        <span class="ficha-arm">${esc([i.dosagem, i.apresentacao].filter(Boolean).join(' · '))}</span>
        <span class="estado-arm">${rot[1]}</span>
        ${i.lote ? `<span class="lote-arm">lote ${esc(i.lote)}</span>` : ''}
      </span>
      <span class="acoes-arm">
        ${i.estado === 'recolhido' ? `
          <button class="acabou resolvi" data-armario="resolvi:${i.id}">já devolvi</button>`
        : `<span class="contador">
          <button data-armario="menos:${i.id}" aria-label="Menos">−</button>
          <span>${i.qtd_atual}</span>
          <button data-armario="mais:${i.id}" aria-label="Mais">+</button>
        </span>
        <button class="acabou" data-armario="acabou:${i.id}">acabou</button>`}
      </span>
    </div>`;
  };

  return `
  <div class="tela"><div class="rolagem">
    <div class="cabeca"><button class="voltar" data-ir="voltar">${IC.volta}</button><h1>Seu armário</h1></div>
    <p class="sub-tela">O que você tem em casa, com o lote e a validade que a farmácia
      registrou na separação.</p>

    ${urgentes.length ? `
      <div class="secao"><h2 style="color:var(--hot)">Precisa de ação</h2></div>
      <div class="lista-armario">${urgentes.map(cartao).join('')}</div>
      ${urgentes.some((i) => i.estado === 'recolhido') ? `
        <div class="caixa-aviso a-hot" style="margin:12px 18px 0">
          <h4>O que fazer com um lote recolhido</h4>
          Não use e não jogue no lixo comum. Leve na farmácia: a gente troca ou
          devolve o valor, e encaminha o descarte.
          <button class="perguntar" style="margin-top:9px" data-ir="conversa">Falar com a farmacêutica</button>
        </div>` : ''}` : ''}

    ${vencendo.length ? `
      <div class="secao"><h2>Vencendo</h2><span class="nota">até 60 dias</span></div>
      <div class="lista-armario">${vencendo.map(cartao).join('')}</div>` : ''}

    ${ok.length ? `
      <div class="secao"><h2>Em casa</h2><span class="nota">${ok.length} ${ok.length === 1 ? 'item' : 'itens'}</span></div>
      <div class="lista-armario">${ok.map(cartao).join('')}</div>` : ''}

    ${!itens.length ? `<div class="vazio"><span class="emoji">🗄️</span>
      Seu armário está vazio.<br>Cada entrega entra aqui sozinha, com lote e validade.</div>` : ''}

    <div class="nota-armario">
      <b>Por que a gente sabe disso</b>
      Na separação, cada caixa é bipada e o lote e a validade ficam gravados no
      seu pedido. É o que nos deixa avisar você — e só você — quando um lote é
      recolhido, em vez de publicar um comunicado que ninguém lê.
    </div>
  </div></div>`;
}

/* ============ tela: conta ============ */
function telaConta() {
  const d = S.inicio;
  const u = d?.user;
  const ends = S.dados.enderecos ?? [];
  return `
  <div class="tela"><div class="rolagem">
    <div class="cabeca"><h1>Sua conta</h1></div>

    <div class="cartao-perfil">
      <span class="retrato-grande">${esc(iniciais(u?.nome ?? '?'))}</span>
      <div class="quem">
        <b>${esc(u?.nome ?? '')}</b>
        <span>${esc(S.eu?.email ?? '')}</span>
      </div>
    </div>


    <div class="secao"><h2>O que você tem em casa</h2></div>
    <button class="cartao-armario" data-ir="armario">
      <span class="ic">${IC.armario}</span>
      <span class="tx"><b>Seu armário</b>
        <span>${S.dados.resumoArmario?.total
          ? `${S.dados.resumoArmario.total} ${S.dados.resumoArmario.total === 1 ? 'item' : 'itens'} com lote e validade`
          : 'cada entrega entra aqui sozinha'}</span></span>
      ${S.dados.resumoArmario?.vencendo || S.dados.resumoArmario?.recolhidos
        ? `<span class="selo-armario">${(S.dados.resumoArmario.vencendo ?? 0) + (S.dados.resumoArmario.recolhidos ?? 0)}</span>` : ''}
      ${IC.seta}
    </button>

    <div class="secao"><h2>Precisa de ajuda?</h2></div>
    <button class="cartao-farma" data-ir="conversa">
      <span class="retrato-farma">${IC.balao}</span>
      <span class="tx"><b>Falar com o farmacêutico</b>
        <span>Dúvida de dose, interação, se pode tomar junto. Responde gente com CRF.</span></span>
      ${IC.seta}
    </button>

    <div class="secao"><h2>Avisos</h2></div>
    <div class="lista-conta">
      <button class="chave ${S.dados.pushLigado ? 'ligada' : ''}" data-push="1">
        <span class="ic">${IC.sino}</span>
        <span class="tx"><b>Avisar no celular</b>
          <span>${S.dados.pushLigado ? 'Ligado neste aparelho'
            : avisosBloqueados() ? 'Bloqueado no navegador — libere nas configurações'
            : 'Quando a farmácia confirma, sai e chega'}</span></span>
        <span class="botao-chave"></span>
      </button>
      ${S.dados.pushLigado ? `
        <button class="chave" data-testar="1">
          <span class="ic">${IC.sino}</span>
          <span class="tx"><b>Testar um aviso</b>
            <span>Dispara agora um aviso de verdade, como os do pedido.</span></span>
          <span class="seta-chave">${IC.seta}</span>
        </button>` : ''}
      <button class="chave ${u?.push_detalhado ? 'ligada' : ''}" data-detalhe="1">
        <span class="ic">${IC.receita}</span>
        <span class="tx"><b>Mostrar o nome do remédio</b>
          <span>Aviso na tela bloqueada aparece para quem olhar o celular.
            Desligado, ele diz só o número do pedido.</span></span>
        <span class="botao-chave"></span>
      </button>
    </div>

    ${!S.dados.instalado && S.dados.podeInstalar ? `
      <div class="cartao-instalar">
        <span class="lg">${marca({ tam: 46 })}</span>
        <span class="tx"><b>Instalar na tela inicial</b>
          <span>Abre sem barra de navegador e funciona sem internet para olhar o catálogo.</span></span>
        <button class="btn-instalar" data-instalar="1">Instalar</button>
      </div>` : ''}

    <div class="secao"><h2>Endereços</h2><span class="mais" data-enderecos="1">trocar</span></div>
    <div class="lista-conta">
      ${ends.length ? ends.map((e) => `
        <div class="linha-conta">
          <span class="ic">${IC.casa}</span>
          <span class="tx"><b>${esc(e.apelido ?? 'Endereço')}</b>
            <span>${esc(e.logradouro)}${e.numero ? ', ' + esc(e.numero) : ''} · ${esc(e.bairro)}</span></span>
          ${e.id === (S.enderecoId ?? ends[0].id) ? '<span class="tag-atual">em uso</span>' : ''}
        </div>`).join('')
        : '<div class="linha-conta"><span class="tx"><b>Nenhum endereço salvo</b></span></div>'}
    </div>

    <div class="secao"><h2>Onde entregamos</h2></div>
    <div class="bairros">${(d?.area ?? []).map((b) => `<span class="bairro">${esc(b)}</span>`).join('')}</div>
    <p class="nota-area">Estamos só nesses bairros por enquanto. Cresce conforme a moto dá conta.</p>

    <div class="secao"><h2>A farmácia</h2></div>
    <div class="lista-conta">
      <div class="linha-conta">
        <span class="ic">${sinal(18)}</span>
        <span class="tx"><b>${esc(S.dados.vitrine?.nome_fantasia ?? d?.farmacia?.nome ?? 'Solmedic+')}</b>
          <span>${esc(S.dados.vitrine?.razao_social ?? '')}</span></span>
      </div>
      ${S.dados.vitrine ? `
      <div class="linha-conta"><span class="ic">${IC.receita}</span>
        <span class="tx"><b>Responsável técnico</b>
          <span>${esc(S.dados.vitrine.responsavel_tecnico?.nome ?? '—')} · ${esc(S.dados.vitrine.responsavel_tecnico?.crf ?? '')}</span></span></div>
      <div class="linha-conta"><span class="ic">${IC.telefone}</span>
        <span class="tx"><b>${esc(S.dados.vitrine.telefone ?? '')}</b>
          <span>CNPJ ${esc(S.dados.vitrine.cnpj ?? '')}</span></span></div>
      <div class="linha-conta"><span class="ic">${IC.relogio}</span>
        <span class="tx"><b>${esc(S.dados.vitrine.logradouro ?? '')}${S.dados.vitrine.numero ? ', ' + esc(S.dados.vitrine.numero) : ''}</b>
          <span>${esc(S.dados.vitrine.bairro ?? '')} · ${esc(S.dados.vitrine.cidade ?? '')}/${esc(S.dados.vitrine.uf ?? '')}</span></span></div>` : ''}
    </div>

    <button class="botao-grande claro" style="margin:20px 18px 0;width:calc(100% - 36px)"
      data-sair="1">Sair da conta</button>
    <p class="rodape-app">Solmedic+ · protótipo · ${d?.receita_habilitada ? 'aviando receita' : 'só venda livre'}</p>
  </div></div>`;
}

/* ============ tela: entrar e criar conta ============ */
function telaLogin() {
  const novo = S.modoCadastro;
  return `
  <div class="tela"><div class="login">
    <div class="marca-login">${marca({ tam: 62 })}</div>
    <div style="margin-bottom:10px">${logotipo({ tam: 26 })}</div>
    <h1>${novo ? 'Criar sua conta' : 'O remédio certo,<br>sempre'}</h1>
    <p>${novo
      ? 'Leva menos de um minuto. Depois é só escolher onde entregar.'
      : 'Entre para acompanhar a entrega, ver o que você tem em casa e nunca mais esquecer a recompra.'}</p>
    ${S.erro ? `<div class="erro-caixa" style="margin:0 0 14px;width:100%">${esc(S.erro)}</div>` : ''}
    <form id="flogin">
      ${novo ? `
        <label for="nome">Seu nome</label>
        <label class="campo"><input id="nome" autocomplete="name" placeholder="Nome e sobrenome"></label>
        <label for="tel">Celular</label>
        <label class="campo"><input id="tel" inputmode="tel" autocomplete="tel" placeholder="85 9 9999-0000"></label>` : ''}
      <label for="email">E-mail</label>
      <label class="campo"><input id="email" type="email"
        value="${novo ? '' : 'cliente@exemplo.com'}" autocomplete="${novo ? 'email' : 'username'}"></label>
      <label for="senha">Senha</label>
      <label class="campo"><input id="senha" type="password"
        value="${novo ? '' : 'cliente123'}" autocomplete="${novo ? 'new-password' : 'current-password'}"
        placeholder="${novo ? 'pelo menos 6 caracteres' : ''}"></label>
      <button class="botao-grande" style="margin-top:8px" ${S.ocupado ? 'disabled' : ''}>
        ${S.ocupado ? (novo ? 'Criando…' : 'Entrando…') : (novo ? 'Criar conta' : 'Entrar')}</button>
    </form>

    <button class="troca-modo" data-modo="${novo ? 'entrar' : 'cadastro'}">
      ${novo ? 'Já tenho conta — entrar' : 'Não tenho conta — criar uma'}</button>

    <div class="dica-conta">
      ${novo ? '' : 'Conta de teste já preenchida.<br>'}
      <a class="link-loja" href="painel.html">Sou a farmácia — abrir o painel →</a>
      <a class="link-loja" href="entregador.html">Sou entregador — abrir as corridas →</a>
    </div>
  </div></div>`;
}

/**
 * Cadastrar endereço.
 *
 * Conta nova não tem para onde entregar, e descobrir isso no fim do
 * carrinho é a pior hora possível. O bairro é uma lista, não um campo
 * livre: é ela que decide se a gente entrega ou não.
 */
function telaEndereco() {
  const area = S.inicio?.area ?? [];
  return `
  <div class="tela"><div class="rolagem">
    <div class="cabeca"><button class="voltar" data-ir="voltar">${IC.volta}</button><h1>Onde entregar</h1></div>
    <p class="sub-tela">A farmácia e o prazo mudam conforme o bairro. Hoje a gente entrega
      em ${area.join(', ') || 'alguns bairros'}.</p>
    ${S.erro ? `<div class="erro-caixa" style="margin:0 18px 14px">${esc(S.erro)}</div>` : ''}

    <button class="usar-gps" id="gps" type="button">
      <span class="ic-gps"></span>
      <span class="tx"><b>Usar minha localização</b>
        <span>preenche rua e bairro pelo GPS do aparelho</span></span>
    </button>

    <form id="fendereco" class="form-endereco">
      <label class="campo-rot"><span>Apelido</span>
        <input id="apelido" placeholder="Casa, trabalho…" value="Casa"></label>
      <label class="campo-rot"><span>Rua</span>
        <input id="logradouro" placeholder="Rua, avenida…" autocomplete="street-address"></label>
      <div class="par">
        <label class="campo-rot"><span>Número</span><input id="numero" inputmode="numeric"></label>
        <label class="campo-rot"><span>Complemento</span><input id="complemento" placeholder="apto, bloco"></label>
      </div>
      <label class="campo-rot"><span>Bairro</span>
        <select id="bairro">
          ${area.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('')}
          <option value="__fora">Meu bairro não está na lista</option>
        </select></label>
      <div class="par">
        <label class="campo-rot"><span>Cidade</span><input id="cidade" value="Fortaleza"></label>
        <label class="campo-rot"><span>UF</span><input id="uf" value="CE" maxlength="2"></label>
      </div>
      <label class="campo-rot"><span>CEP</span><input id="cep" inputmode="numeric" placeholder="60000-000"></label>
      <button class="botao-grande" style="margin-top:6px" ${S.ocupado ? 'disabled' : ''}>
        ${S.ocupado ? 'Salvando…' : 'Salvar endereço'}</button>
    </form>
  </div></div>`;
}

/* ============================================================
   PALCO — uma tela entra, a outra sai. A barra de baixo fica.
   ============================================================ */
const fone = document.getElementById('raiz');
const palco = document.getElementById('palco');
const compacta = document.getElementById('compacta');
const torradas = document.getElementById('torradas');
const doca = document.getElementById('doca');

const ABAS = ['inicio', 'busca', 'receitas', 'pedidos'];
let telaAtual = null;
let proximoModo = 'aba';
let pilha = ['inicio'];
const rolagens = new Map();

let mapaVivo = null;
const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
const vibra = (ms = 8) => { try { navigator.vibrate?.(ms); } catch {} };

function pinta(html) {
  const molde = document.createElement('div');
  molde.innerHTML = html.trim();
  const nova = molde.firstElementChild;
  if (!nova) return;
  const antiga = telaAtual;

  // atualização de dados na mesma tela: troca sem animar
  if (proximoModo === 'nada' && antiga) {
    const topo = antiga.scrollTop;
    antiga.replaceWith(nova);
    nova.scrollTop = topo;
    telaAtual = nova;
    return depoisDePintar();
  }

  palco.appendChild(nova);
  if (antiga && !calmo) {
    const par = proximoModo === 'push' ? ['entra-push', 'sai-push']
      : proximoModo === 'pop' ? ['entra-pop', 'sai-pop']
      : ['entra-aba', 'sai-aba'];
    nova.classList.add(par[0]);
    antiga.classList.add(par[1]);
    const limpa = () => { antiga.remove(); nova.classList.remove(par[0]); };
    setTimeout(limpa, 400);
  } else if (antiga) antiga.remove();

  telaAtual = nova;
  proximoModo = 'nada';
  depoisDePintar();
}

function depoisDePintar() {
  const base = S.rota.split('/')[0].split('?')[0];
  desenhaDoca();
  ligaRolagem(base);
  ligaCarrossel();
  ligaBarraProduto();
  const guardado = rolagens.get(S.rota);
  if (guardado && base !== 'busca') telaAtual.scrollTop = guardado;
  const campo = telaAtual.querySelector('#q');
  if (campo && document.activeElement !== campo) campo.focus({ preventScroll: true });
  preencheProgresso();
  montaRastreio();
}

/* ---------- a doca: abas + tira contextual, um objeto só ---------- */
const ABAS_BASE = [
  ['inicio', 'casa', 'Início'],
  ['busca', 'busca', 'Buscar'],
  ['pedidos', 'sacola', 'Pedidos'],
  ['conta', 'conta', 'Conta'],
];

function abasAtivas() {
  const abas = [...ABAS_BASE];
  // receita só entra na barra quando a operação aviar receita
  if (S.inicio?.receita_habilitada) abas.splice(2, 0, ['receitas', 'receita', 'Receitas']);
  return abas;
}

function desenhaDoca() {
  const base = S.rota.split('/')[0].split('?')[0];
  if (!S.token) { doca.hidden = true; compacta.hidden = true; return; }
  // rastreio e conversa são tela cheia: a doca sai de cena.
  // A conversa tem a própria barra de escrever, e duas barras empilhadas
  // no rodapé é exatamente o que a doca veio resolver.
  if (base === 'pedido' || base === 'conversa' || base === 'produto') {
    doca.classList.add('escondida'); compacta.hidden = true; return;
  }
  doca.hidden = false;
  doca.classList.remove('escondida');

  const abas = abasAtivas();
  const i = abas.findIndex(([r]) => r === base);
  const n = abas.length;
  const emAndamento = S.inicio?.pedido_em_andamento;
  const noCarrinho = totalItens();

  doca.innerHTML = `
    <div class="fio" style="--andado:${emAndamento ? (progressoDoStatus(emAndamento.status) * 100).toFixed(0) : 0}%"></div>
    <div class="tira ${emAndamento || (noCarrinho && base !== 'carrinho') ? 'aberta' : ''}">
      <div class="dentro">${tiraContexto(emAndamento, noCarrinho, base)}</div>
    </div>
    <nav class="abas" style="grid-template-columns:repeat(${n},1fr)">
      <span class="pilula"></span>
      ${abas.map(([rota, icone, rotulo], k) => `
        <button data-ir="${rota}" class="${k === i ? 'on' : ''}" aria-current="${k === i}">
          ${rota === 'receitas' && S.dados.receitasPendentes ? '<span class="aviso"></span>' : ''}
          ${rota === 'pedidos' && S.dados.pedidosAbertos ? `<span class="selo-aba">${S.dados.pedidosAbertos}</span>` : ''}
          <span class="icone">${ABA[icone].linha.replace('<svg', '<svg class="linha"')}${ABA[icone].cheia.replace('<svg', '<svg class="cheia"')}</span>
          <span class="rotulo">${rotulo}</span>
        </button>`).join('')}
    </nav>`;

  posicionaPilula(i, n);
}

/** A pílula vai até a aba nova esticando no caminho — peso, não teletransporte. */
function posicionaPilula(i, n, animar = false) {
  const pilula = doca.querySelector('.pilula');
  if (!pilula) return;
  if (i < 0) { pilula.style.opacity = '0'; return; }
  pilula.style.opacity = '1';
  const larguraAba = doca.getBoundingClientRect().width / n;
  const larg = Math.min(58, larguraAba - 10);
  pilula.style.setProperty('--larg', larg + 'px');
  pilula.style.setProperty('--esq', (larguraAba * i + (larguraAba - larg) / 2) + 'px');
  if (animar && !calmo) {
    pilula.classList.add('voando');
    setTimeout(() => pilula.classList.remove('voando'), 260);
  }
}

/** O que a tira diz agora: pedido a caminho ganha do carrinho. */
function tiraContexto(pedido, itens, base) {
  if (pedido) {
    return `<button class="tira-conteudo" data-ir="pedido/${pedido.id}">
      <span class="pulso"></span>
      <span class="tx"><b>${esc(pedido.codigo)} · ${ROTULO[pedido.status] ?? ''}</b>
        <span>toque para acompanhar no mapa</span></span>
      ${pedido.status === 'em_rota' ? `<span class="hora-chegada">${esc(pedido.eta ?? '')}</span>` : ''}
      <span class="seta">${IC.seta}</span>
    </button>`;
  }
  if (itens && base !== 'carrinho') {
    return `<button class="tira-conteudo" data-ir="carrinho">
      <span class="conta">${itens}</span>
      <span class="tx"><b>Ver carrinho</b>
        <span>${itens} ${itens === 1 ? 'item' : 'itens'} · ${esc(S.inicio?.farmacia?.nome ?? 'Solmedic+')}</span></span>
      <span class="seta">${IC.seta}</span>
    </button>`;
  }
  return '';
}

/** Pontinhos do carrossel: acompanham o dedo. */
function ligaCarrossel() {
  const rail = telaAtual?.querySelector('#rail');
  const dots = telaAtual?.querySelector('#dots');
  if (!rail || !dots || rail.dataset.ligado) return;
  rail.dataset.ligado = '1';
  rail.addEventListener('scroll', () => {
    const i = Math.round(rail.scrollLeft / (rail.clientWidth || 1));
    for (let k = 0; k < dots.children.length; k++) dots.children[k].classList.toggle('on', k === i);
  }, { passive: true });
}

/* ---------- barra compacta que desce ao rolar ---------- */
function ligaRolagem(base) {
  compacta.hidden = base !== 'inicio';
  if (base !== 'inicio') { compacta.classList.remove('visivel'); return; }
  compacta.innerHTML = `
    <span class="mini" data-ir="busca">${IC.busca}<b>Busque um remédio</b></span>
    <button class="redondo" data-ir="carrinho" aria-label="Carrinho">${IC.carrinho}
      ${totalItens() ? `<span class="selo" id="selo">${totalItens()}</span>` : ''}</button>`;
  telaAtual.addEventListener('scroll', () => {
    compacta.classList.toggle('visivel', telaAtual.scrollTop > 118);
    rolagens.set(S.rota, telaAtual.scrollTop);
  }, { passive: true });
}

/**
 * A barra da página do produto começa transparente sobre a vitrine e
 * ganha fundo e título conforme você rola. Botão redondo flutuando em
 * cima da imagem é o atalho que todo mundo usa e que fica feio.
 */
function ligaBarraProduto() {
  const barra = telaAtual?.querySelector('#barraProduto');
  const rolagem = telaAtual?.querySelector('.rolagem');
  if (!barra || !rolagem || rolagem.dataset.barraLigada) return;
  rolagem.dataset.barraLigada = '1';
  const ajusta = () => barra.classList.toggle('presa', rolagem.scrollTop > 132);
  rolagem.addEventListener('scroll', ajusta, { passive: true });
  ajusta();
}

/* ---------- mapa + folha arrastável ---------- */
function montaRastreio() {
  const caixa = telaAtual?.querySelector('#mapa');
  if (!caixa) { mapaVivo?.destroi(); mapaVivo = null; return; }
  const p = S.dados.pedido;
  const alvo = progressoDoStatus(p?.status);

  if (!caixa.firstElementChild) {
    mapaVivo?.destroi();
    mapaVivo = criaMapa(caixa, {
      progresso: alvo,
      origem: p?.farmacia?.lat ? { lat: p.farmacia.lat, lng: p.farmacia.lng } : null,
      destino: p?.endereco?.lat ? { lat: p.endereco.lat, lng: p.endereco.lng } : null,
    });
    // em rota, a moto continua andando devagar até chegar
    if (p?.status === 'em_rota') setTimeout(() => mapaVivo?.anima(0.92, 26000), 700);
  } else if (mapaVivo) {
    mapaVivo.anima(alvo, 1500);
  }

  ligaFolha();
}

/** Dois pontos de parada, como no Uber: espiar o mapa ou ler o pedido. */
function ligaFolha() {
  const folha = telaAtual?.querySelector('#folha');
  const alca = telaAtual?.querySelector('#alca');
  if (!folha || !alca || alca.dataset.ligado) return;
  alca.dataset.ligado = '1';
  const PARADAS = [34, 62, 88];
  let arrastando = false, y0 = 0, alt0 = 0;

  const altAtual = () => folha.getBoundingClientRect().height / folha.parentElement.getBoundingClientRect().height * 100;

  alca.addEventListener('pointerdown', (e) => {
    arrastando = true; y0 = e.clientY; alt0 = altAtual();
    folha.classList.add('arrastando');
    alca.setPointerCapture(e.pointerId);
  });
  alca.addEventListener('pointermove', (e) => {
    if (!arrastando) return;
    const alturaPai = folha.parentElement.getBoundingClientRect().height;
    const nova = Math.max(22, Math.min(90, alt0 + (y0 - e.clientY) / alturaPai * 100));
    folha.style.setProperty('--folha-alt', nova + '%');
  });
  const solta = () => {
    if (!arrastando) return;
    arrastando = false;
    folha.classList.remove('arrastando');
    const atual = altAtual();
    const perto = PARADAS.reduce((a, b) => Math.abs(b - atual) < Math.abs(a - atual) ? b : a);
    folha.style.setProperty('--folha-alt', perto + '%');
    vibra(6);
  };
  alca.addEventListener('pointerup', solta);
  alca.addEventListener('pointercancel', solta);
  alca.addEventListener('click', () => {
    const atual = altAtual();
    folha.style.setProperty('--folha-alt', (atual > 70 ? 34 : 88) + '%');
    vibra(8);
  });
}

/* ---------- linha do tempo que preenche ---------- */
function preencheProgresso() {
  const passos = telaAtual?.querySelector('.passos');
  if (!passos) return;
  const feitos = passos.querySelectorAll('.passo.feito').length;
  const agora = passos.querySelector('.passo.agora') ? 1 : 0;
  const total = passos.querySelectorAll('.passo').length;
  const frac = total ? (feitos + agora * 0.5) / total : 0;
  requestAnimationFrame(() => passos.style.setProperty('--altura',
    `calc(${(frac * 100).toFixed(1)}% - 14px)`));
}

/** A conversa anda sozinha: resposta do farmacêutico cai na tela. */
function ligaConversa() {
  const c = S.dados.conversa;
  if (!c) return;
  S.fonteConversa?.close();
  S.fonteConversa = new EventSource(`/api/conversa/${c.id}/stream`);
  S.fonteConversa.onmessage = async (ev) => {
    const d = JSON.parse(ev.data);
    if (d.tipo !== 'mensagem') return;
    S.dados.conversa = await api('GET', '/api/conversa').catch(() => S.dados.conversa);
    proximoModo = 'nada'; desenha();
    if (d.mensagem?.autor_tipo === 'farmaceutico') { vibra(14); rolaFio(); }
  };
  rolaFio();
}
const rolaFio = () => requestAnimationFrame(() => {
  const fio = telaAtual?.querySelector('#fio');
  if (fio) fio.scrollTop = fio.scrollHeight;
});

async function mandaMensagem(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return;
  const campo = telaAtual?.querySelector('#msg');
  if (campo) campo.value = '';
  // aparece na hora; se falhar, o recarregamento corrige
  S.dados.conversa?.mensagens.push({
    id: 'tmp' + Date.now(), autor_tipo: 'cliente', texto: t, criado_em: new Date().toISOString(),
  });
  proximoModo = 'nada'; desenha(); rolaFio();
  try {
    S.dados.conversa = await api('POST', '/api/conversa', { texto: t });
    proximoModo = 'nada'; desenha(); rolaFio();
  } catch (e) { aviso(e.message, { bom: false }); }
}

/* ============ notificações ============ */
/**
 * A permissão não é pedida na abertura. Pedimos depois do primeiro
 * pedido, que é quando o aviso serve para alguma coisa — antes disso,
 * é só um jeito rápido de ganhar um "bloquear" para sempre.
 */
async function ofereceAvisos({ forcado = false } = {}) {
  if (!('Notification' in window)) return;
  if (!forcado) {
    if (avisos.estadoDaPermissao() !== 'default') return;
    if (localStorage.getItem('sm_avisos_perguntei')) return;
    localStorage.setItem('sm_avisos_perguntei', '1');
    const quer = await folha({
      titulo: 'Quer saber quando sair para entrega?',
      texto: 'A gente avisa quando a farmácia confirma, quando o entregador sai '
        + 'e quando ele está chegando. Nada de propaganda.',
      acoes: [{ rotulo: 'Pode avisar', tipo: 'principal', valor: true },
              { rotulo: 'Agora não', valor: false }],
    });
    if (!quer) return;
  }
  const r = await avisos.ligaAvisos(api);
  aviso(r.ok ? 'Avisos ligados' : r.motivo, { bom: r.ok });
  if (r.ok) vibra(14);
  return r;
}

/** Puxa o histórico e liga o canal pessoal. */
async function ligaCanalPessoal() {
  S.fechaAvisos?.();
  const n = await api('GET', '/api/notificacoes').catch(() => null);
  if (n) { S.dados.notificacoes = n.itens; S.naoLidas = n.nao_lidas; desenhaDoca(); }
  S.fechaAvisos = avisos.ouveAvisos(S.token, (nova) => {
    S.dados.notificacoes = [nova, ...(S.dados.notificacoes ?? [])];
    S.naoLidas += 1;
    desenhaDoca();
    aviso(nova.titulo);
    vibra(12);
    // com o app em segundo plano, o aviso sai na bandeja do sistema
    if (document.hidden) avisos.avisaLocal(nova);
  });
}

/* ============ avisos e folha ============ */
function aviso(texto, { bom = true } = {}) {
  const t = document.createElement('div');
  t.className = 'torrada';
  t.innerHTML = `${bom ? '<span class="ok">✓</span>' : '<span class="ok" style="background:#FF8AA0;color:#4A0714">!</span>'}<span>${esc(texto)}</span>`;
  torradas.appendChild(t);
  setTimeout(() => { t.classList.add('saindo'); setTimeout(() => t.remove(), 240); }, 2300);
}

function folha({ titulo, texto, acoes }) {
  return new Promise((resolve) => {
    const fundo = document.createElement('div');
    fundo.className = 'folha-fundo';
    const caixa = document.createElement('div');
    caixa.className = 'folha';
    caixa.innerHTML = `<div class="puxador"></div>
      <h3>${esc(titulo)}</h3>${texto ? `<p>${esc(texto)}</p>` : ''}
      <div class="acoes">${acoes.map((a, i) => `
        <button class="botao-grande ${a.tipo === 'principal' ? '' : 'claro'}"
          data-i="${i}" style="font-size:14px;height:auto;min-height:50px;padding:10px 16px;text-align:center">${esc(a.rotulo)}</button>`).join('')}</div>`;
    const fecha = (v) => {
      caixa.classList.add('saindo'); fundo.classList.add('saindo');
      setTimeout(() => { caixa.remove(); fundo.remove(); resolve(v); }, 260);
    };
    fundo.addEventListener('click', () => fecha(null));
    caixa.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) { vibra(); fecha(acoes[Number(b.dataset.i)].valor); }
    });
    fone.append(fundo, caixa);
  });
}

/** Trocar endereço: o chevron ao lado do endereço tem que fazer alguma coisa. */
async function escolheEndereco() {
  const lista = S.dados.enderecos ?? (S.dados.enderecos = await api('GET', '/api/enderecos').catch(() => []));
  if (!lista.length) { proximoModo = 'nada'; return vaiPara('endereco'); }
  const atual = S.enderecoId ?? lista[0].id;
  const escolha = await folha({
    titulo: 'Entregar onde?',
    texto: 'A farmácia e o prazo mudam conforme o bairro.',
    acoes: lista.map((e) => ({
      rotulo: `${e.apelido ? e.apelido + ' · ' : ''}${e.logradouro}${e.numero ? ', ' + e.numero : ''} — ${e.bairro}`
        + (e.id === atual ? '   ✓' : ''),
      tipo: e.id === atual ? 'principal' : 'claro',
      valor: e.id,
    })).concat([{ rotulo: '+ Cadastrar outro endereço', tipo: 'claro', valor: '__novo' }]),
  });
  if (escolha === '__novo') { proximoModo = 'nada'; return vaiPara('endereco'); }
  if (!escolha || escolha === S.enderecoId) return;
  S.enderecoId = escolha;
  localStorage.setItem('sm_endereco', escolha);
  aviso('Endereço trocado');
  proximoModo = 'nada';
  carrega('inicio');
}

/* ============ voo até o carrinho ============ */
function voaAoCarrinho(origem) {
  const arte = origem.closest('.prod, .continuo, .achado, .tela')?.querySelector('.vitrine svg, .arte svg, svg');
  const destino = doca?.querySelector('.tira-conteudo')
    ?? (compacta.classList.contains('visivel') ? compacta.querySelector('.redondo')
      : telaAtual?.querySelector('.redondo'));
  if (!arte || !destino || calmo) return bateSelo();
  const a = arte.getBoundingClientRect(), b = destino.getBoundingClientRect();
  const voo = document.createElement('div');
  voo.className = 'voando';
  voo.style.cssText += `;left:${a.left}px;top:${a.top}px;width:${a.width}px;height:${a.height}px`;
  voo.innerHTML = arte.outerHTML;
  document.body.appendChild(voo);
  requestAnimationFrame(() => {
    const escala = Math.max(0.18, (b.width * 0.55) / Math.max(a.width, 1));
    voo.style.transform =
      `translate(${b.left + b.width / 2 - a.left - a.width / 2}px, ${b.top + b.height / 2 - a.top - a.height / 2}px) scale(${escala})`;
    voo.style.opacity = '.25';
    voo.style.borderRadius = '50%';
  });
  setTimeout(() => { voo.remove(); bateSelo(); desenhaDoca(); }, 560);
}

function bateSelo() {
  for (const alvo of [compacta, telaAtual]) {
    const botao = alvo?.querySelector?.('.redondo');
    if (!botao) continue;
    let selo = botao.querySelector('.selo');
    if (!selo) {
      selo = document.createElement('span');
      selo.className = 'selo';
      botao.appendChild(selo);
    }
    selo.textContent = totalItens();
    selo.classList.remove('pula');
    void selo.offsetWidth;
    selo.classList.add('pula');
  }
}

/* ============ roteador ============ */
function desenha() {
  if (!S.token) {
    doca.hidden = true; compacta.hidden = true;
    palco.innerHTML = telaLogin();
    telaAtual = palco.firstElementChild;
    return ligaFormulario();
  }
  const base = S.rota.split('/')[0].split('?')[0];
  const mapa = {
    inicio: telaInicio, busca: telaBusca, produto: telaProduto, carrinho: telaCarrinho,
    receitas: telaReceitas, pedido: telaPedido, pedidos: telaPedidos, conta: telaConta,
    avisos: telaAvisos, conversa: telaConversa, armario: telaArmario,
    endereco: telaEndereco,
  };
  pinta((mapa[base] || telaInicio)());
  ligaFormulario();
}

function vaiPara(rota) {
  const abas = abasAtivas();
  const iNovo = abas.findIndex(([r]) => r === rota.split('/')[0].split('?')[0]);
  if (iNovo >= 0) setTimeout(() => posicionaPilula(iNovo, abas.length, true), 0);
  if (rota === 'voltar') {
    pilha.pop();
    rota = pilha[pilha.length - 1] || 'inicio';
    proximoModo = 'pop';
  } else {
    const baseNova = rota.split('/')[0].split('?')[0];
    const baseVelha = S.rota.split('/')[0].split('?')[0];
    if (ABAS.includes(baseNova) && ABAS.includes(baseVelha)) { proximoModo = 'aba'; pilha = [rota]; }
    else if (baseNova === baseVelha && rota !== S.rota) { proximoModo = 'push'; pilha.push(rota); }
    else { proximoModo = 'push'; pilha.push(rota); }
  }
  if (telaAtual) rolagens.set(S.rota, telaAtual.scrollTop);
  S.rota = rota;
  history.replaceState(null, '', '#' + rota);
  if (S.fonte && !rota.startsWith('pedido/')) { S.fonte.close(); S.fonte = null; }
  vibra(6);
  carrega(rota);
}

async function carrega(rota) {
  const [caminho, query] = rota.split('?');
  const [base, arg] = caminho.split('/');
  const q = new URLSearchParams(query || '');
  S.erro = null;
  try {
    if (base === 'inicio') {
      S.inicio = await api('GET', '/api/inicio');
      S.dados.pedidosAbertos = S.inicio.pedidos_abertos ?? 0;
      if (!S.dados.sintomas) {
        api('GET', '/api/sintomas')
          .then((r) => { S.dados.sintomas = r.itens; proximoModo = 'nada'; desenha(); })
          .catch(() => {});
      }
      if (!S.dados.vitrine && S.inicio.farmacia?.id) {
        api('GET', `/api/farmacias/${S.inicio.farmacia.id}`)
          .then((v) => { S.dados.vitrine = v; proximoModo = 'nada'; desenha(); }).catch(() => {});
      }
      api('GET', '/api/enderecos').then((l) => { S.dados.enderecos = l; }).catch(() => {});
      desenha();
    }
    else if (base === 'busca') {
      const cat = q.get('cat');
      if (cat) { S.dados.busca = { q: (CATS[cat] || [cat])[0], carregando: true }; desenha(); await buscaCategoria(cat); atualizaResultados(); }
      else {
        if (!S.dados.sintomas) {
          S.dados.sintomas = (await api('GET', '/api/sintomas').catch(() => ({ itens: [] }))).itens;
        }
        desenha();
        if (S.dados.busca?.q) { await buscar(S.dados.busca.q); atualizaResultados(); }
      }
    }
    else if (base === 'produto' && arg) {
      S.dados.produto = null; desenha();
      const p = await api('GET', `/api/catalogo/${arg}`);
      if (p.referencia_ean) {
        p.referencia = await api('GET', `/api/catalogo/${p.referencia_ean}`).catch(() => null);
        if (p.referencia?.ofertas?.[0] && p.ofertas?.[0]) {
          p.economia_vs_referencia = p.referencia.ofertas[0].preco_centavos - p.ofertas[0].preco_centavos;
        }
      }
      S.dados.produto = p;
      if (!S.dados.vitrine && S.inicio?.farmacia?.id) {
        S.dados.vitrine = await api('GET', `/api/farmacias/${S.inicio.farmacia.id}`).catch(() => null);
      }
      proximoModo = 'nada'; desenha();
    }
    else if (base === 'carrinho') { S.dados.orcamento = null; desenha(); await orcar(); proximoModo = 'nada'; desenha(); }
    else if (base === 'receitas') {
      S.dados.receitas = null; desenha();
      S.dados.receitas = await api('GET', '/api/receitas');
      S.dados.receitasPendentes = S.dados.receitas.filter((r) => r.status === 'pendente').length;
      proximoModo = 'nada'; desenha();
    }
    else if (base === 'conversa') {
      desenha();
      S.dados.conversa = await api('GET', '/api/conversa');
      proximoModo = 'nada'; desenha();
      ligaConversa();
      if (S.dados.perguntaPendente) {
        const p = S.dados.perguntaPendente; S.dados.perguntaPendente = null;
        setTimeout(() => mandaMensagem(p), 500);
      }
    }
    else if (base === 'armario') {
      S.dados.armario = null; desenha();
      S.dados.armario = await api('GET', '/api/armario');
      proximoModo = 'nada'; desenha();
    }
    else if (base === 'avisos') {
      desenha();
      const n = await api('GET', '/api/notificacoes').catch(() => ({ itens: [] }));
      S.dados.notificacoes = n.itens;
      api('POST', '/api/notificacoes/lidas').catch(() => {});
      S.naoLidas = 0;
      proximoModo = 'nada'; desenha();
    }
    else if (base === 'conta') {
      desenha();
      const [ends, vit] = await Promise.all([
        api('GET', '/api/enderecos').catch(() => []),
        S.inicio?.farmacia?.id ? api('GET', `/api/farmacias/${S.inicio.farmacia.id}`).catch(() => null) : null,
      ]);
      S.dados.enderecos = ends; if (vit) S.dados.vitrine = vit;
      api('GET', '/api/armario').then((a) => {
        S.dados.resumoArmario = a.resumo; proximoModo = 'nada'; desenha();
      }).catch(() => {});
      S.dados.pushLigado = avisos.estadoDaPermissao() === 'granted';
      S.dados.podeInstalar = avisos.podeInstalar();
      S.dados.instalado = avisos.jaInstalado();
      proximoModo = 'nada'; desenha();
    }
    else if (base === 'endereco') {
      // conta recém-criada ainda não carregou a home: a lista de bairros vem daqui
      if (!S.inicio) S.inicio = await api('GET', '/api/inicio').catch(() => null);
      proximoModo = 'nada'; desenha();
    }
    else if (base === 'pedidos') {
      S.dados.pedidos = null; desenha();
      S.dados.pedidos = await api('GET', '/api/pedidos');
      proximoModo = 'nada'; desenha();
    }
    else if (base === 'pedido' && arg) { S.dados.pedido = null; desenha(); await abrePedido(arg); }
    else desenha();
  } catch (e) {
    if (e.status === 401) return sair();
    S.erro = e.message;
    proximoModo = 'nada';
    desenha();
    aviso(e.message, { bom: false });
  }
}

/** Atualiza só a lista de resultados — a busca não pode perder o cursor. */
function atualizaResultados() {
  const alvo = telaAtual?.querySelector('#resultados');
  if (!alvo) return desenha();
  const { q = '' } = S.dados.busca || {};
  const itens = aplicaFiltro(S.dados.busca?.itens || []);
  for (const b of telaAtual.querySelectorAll('[data-filtro]')) {
    b.classList.toggle('on', b.dataset.filtro === S.filtro);
  }
  alvo.innerHTML = !q
    ? `<div class="vazio"><span class="emoji">🔎</span>Digite o nome comercial ou o princípio ativo.<br>Quem procura “Novalgina” encontra dipirona também.</div>`
    : !itens.length
      ? `<div class="vazio"><span class="emoji">∅</span>Nada encontrado para “${esc(q)}”.</div>`
      : `${S.dados.busca?.sintoma ? `
           <div class="faixa-sintoma">
             <b>${esc(S.dados.busca.sintoma.rotulo)}</b>
             <span>${esc(S.dados.busca.sintoma.ressalva)}</span>
           </div>` : ''}
         <div style="font-size:12.5px;color:var(--ink-3);padding:0 18px 12px">
           <b style="color:var(--ink-2)">${itens.length} ${itens.length === 1 ? 'resultado' : 'resultados'}.</b>
           Busca por princípio ativo — a marca mostra o genérico.</div>
         <div class="escalona">${itens.map(linhaAchado).join('')}</div>`;
}

/* ============ ações ============ */
async function buscar(termo) {
  const r = await api('GET', `/api/catalogo/busca?q=${encodeURIComponent(termo)}`).catch(() => ({ itens: [] }));
  S.dados.busca = { q: termo, itens: r.itens || [] };
}
async function buscaCategoria(cat) {
  const r = await api('GET', `/api/catalogo/busca?cat=${encodeURIComponent(cat)}`).catch(() => ({ itens: [] }));
  S.dados.busca = { q: (CATS[cat] || [cat])[0], itens: r.itens || [] };
}

async function orcar() {
  const itens = Object.entries(S.carrinho).map(([ean, qtd]) => ({ ean, qtd }));
  if (!itens.length) { S.dados.orcamento = null; return; }
  if (!S.inicio) S.inicio = await api('GET', '/api/inicio');
  try {
    const o = await api('POST', '/api/carrinho/orcamento', { pharmacy_id: S.inicio.farmacia.id, itens });
    const conhecidos = [...(S.inicio.ofertas || []), ...(S.inicio.continuos || []), ...(S.inicio.recomprar || [])];
    for (const g of ['sai_agora', 'aguarda_farmaceutico']) {
      for (const i of o.grupos[g]) {
        const p = conhecidos.find((x) => x.ean === i.ean);
        i.forma = p?.forma; i.cor = p?.cor;
      }
    }
    S.dados.orcamento = o;
  } catch (e) { S.erro = e.message; S.dados.orcamento = null; }
}

function muda(ean, delta) {
  const n = (S.carrinho[ean] || 0) + delta;
  if (n <= 0) delete S.carrinho[ean]; else S.carrinho[ean] = n;
  salvaCarrinho();
}

async function fechar() {
  S.ocupado = true; S.erro = null; proximoModo = 'nada'; desenha();
  try {
    const enderecos = S.dados.enderecos ?? await api('GET', '/api/enderecos');
    S.dados.enderecos = enderecos;
    if (!enderecos.length) {
      aviso('Falta dizer onde entregar', { bom: false });
      proximoModo = 'nada'; vaiPara('endereco');
      return;
    }
    const escolhido = enderecos.find((e) => e.id === S.enderecoId) ?? enderecos[0];
    const itens = Object.entries(S.carrinho).map(([ean, qtd]) => ({ ean, qtd }));
    const p = await api('POST', '/api/pedidos', {
      pharmacy_id: S.inicio.farmacia.id, address_id: escolhido.id,
      itens, metodo: S.pagamento, cartao_final: '4417',
    });
    S.carrinho = {}; salvaCarrinho();
    S.ocupado = false;
    vibra(18);
    aviso(`Pedido ${p.codigo} enviado para a farmácia`);
    vaiPara(`pedido/${p.id}`);
    setTimeout(() => ofereceAvisos(), 2600);
  } catch (e) {
    S.erro = e.message; S.ocupado = false; proximoModo = 'nada'; desenha();
    aviso(e.message, { bom: false });
  }
}

async function abrePedido(id) {
  S.dados.pedido = await api('GET', `/api/pedidos/${id}`);
  S.dados.nota = 0; S.dados.marcasEscolhidas = [];
  S.dados.pix = null;
  if (S.dados.pedido?.pagamento?.metodo === 'pix'
      && S.dados.pedido.pagamento.status !== 'capturado') {
    S.dados.pix = await api('POST', `/api/pedidos/${id}/pix`).catch(() => null);
  }
  if (!S.dados.marcas) S.dados.marcas = await api('GET', '/api/avaliacoes/marcas').catch(() => ({ bom: [], ruim: [] }));
  // dados que a RDC 44 obriga a exibir: CNPJ, endereço, telefone, RT e CRF
  if (S.dados.pedido?.pharmacy_id) {
    S.dados.vitrine = await api('GET', `/api/farmacias/${S.dados.pedido.pharmacy_id}`).catch(() => null);
  }
  proximoModo = proximoModo === 'nada' ? 'nada' : proximoModo;
  desenha();
  S.fonte?.close();
  S.fonte = new EventSource(`/api/pedidos/${id}/stream`);
  S.fonte.onmessage = async (ev) => {
    const d = JSON.parse(ev.data);
    if (d.tipo === 'conectado') return;
    const antes = S.dados.pedido?.status;
    S.dados.pedido = await api('GET', `/api/pedidos/${id}`).catch(() => S.dados.pedido);
    proximoModo = 'nada'; desenha();
    if (S.dados.pedido?.status !== antes) {
      vibra(14);
      aviso(`Pedido ${ROTULO[S.dados.pedido.status] ?? ''}`);
    }
    if (d.tipo === 'contraproposta') aviso('A farmácia ofereceu um substituto', { bom: false });
  };
}

async function enviaReceita(arquivo) {
  S.ocupado = true; S.erro = null; proximoModo = 'nada'; desenha();
  try {
    const dataUrl = await new Promise((ok, falha) => {
      const fr = new FileReader();
      fr.onload = () => ok(fr.result); fr.onerror = falha;
      fr.readAsDataURL(arquivo);
    });
    const up = await api('POST', '/api/upload', { arquivo: dataUrl, pasta: 'receitas' });
    await api('POST', '/api/receitas', {
      arquivo_url: up.url, prescritor: {},
      emitida_em: new Date().toISOString().slice(0, 10), itens: [],
    });
    S.ocupado = false;
    aviso('Receita enviada para o farmacêutico');
    vibra(14);
    proximoModo = 'nada';
    await carrega('receitas');
  } catch (e) {
    S.erro = e.message; S.ocupado = false; proximoModo = 'nada'; desenha();
    aviso(e.message, { bom: false });
  }
}

function sair() {
  S.fechaAvisos?.(); S.fechaAvisos = null;
  avisos.desligaAvisos(api).catch(() => {});
  localStorage.removeItem('sm_token');
  S.token = null; S.eu = null; S.inicio = null; S.dados = {};
  telaAtual = null; pilha = ['inicio']; S.rota = 'inicio';
  desenha();
}

/* ============ um listener só, para sempre ============ */
function ligaFormulario() {
  const flogin = palco.querySelector('#flogin');
  if (flogin && !flogin.dataset.ligado) {
    flogin.dataset.ligado = '1';
    flogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const novo = S.modoCadastro;
      // lê do formulário que disparou o submit: durante a transição o palco
      // segura duas telas, e querySelector devolveria a de trás
      const val = (id) => e.currentTarget.querySelector('#' + id)?.value?.trim() ?? '';
      if (novo && val('nome').length < 3) {
        S.erro = 'Escreva seu nome'; return desenha();
      }
      if (novo && val('senha').length < 6) {
        S.erro = 'A senha precisa de pelo menos 6 caracteres'; return desenha();
      }
      S.ocupado = true; S.erro = null; desenha();
      try {
        const r = novo
          ? await api('POST', '/api/auth/registrar', {
              nome: val('nome'), email: val('email'), senha: val('senha'),
              telefone: val('tel') || null })
          : await api('POST', '/api/auth/login', { email: val('email'), senha: val('senha') });
        S.token = r.token; localStorage.setItem('sm_token', r.token);
        S.ocupado = false; telaAtual = null; palco.innerHTML = '';
        ligaCanalPessoal();
        proximoModo = 'aba';
        // conta nova não tem para onde entregar: resolve agora, não no carrinho
        if (novo) { S.modoCadastro = false; S.recemCriado = true; vaiPara('endereco'); }
        else vaiPara('inicio');
      } catch (err) {
        S.erro = err.message; S.ocupado = false; desenha(); aviso(err.message, { bom: false });
      }
    });
  }

  const bgps = palco.querySelector('#gps');
  if (bgps && !bgps.dataset.ligado) {
    bgps.dataset.ligado = '1';
    bgps.addEventListener('click', () => pegaLocalizacao(bgps));
  }

  const fend = palco.querySelector('#fendereco');
  if (fend && !fend.dataset.ligado) {
    fend.dataset.ligado = '1';
    fend.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = (id) => e.currentTarget.querySelector('#' + id)?.value?.trim() ?? '';
      if (val('bairro') === '__fora') {
        S.erro = 'A gente ainda não entrega aí. Assim que abrir o bairro, você recebe um aviso.';
        return desenha();
      }
      if (!val('logradouro')) { S.erro = 'Falta a rua'; return desenha(); }
      S.ocupado = true; S.erro = null; desenha();
      try {
        const novo = await api('POST', '/api/enderecos', {
          apelido: val('apelido') || 'Casa', logradouro: val('logradouro'), numero: val('numero'),
          complemento: val('complemento'), bairro: val('bairro'),
          cidade: val('cidade') || 'Fortaleza', uf: (val('uf') || 'CE').toUpperCase(),
          cep: val('cep'), padrao: 1,
          // se o GPS falou, a coordenada dele manda: o mapa da entrega
          // vira o ponto exato em vez do centro do bairro
          lat: S.coord?.lat ?? null, lng: S.coord?.lng ?? null,
        });
        S.dados.enderecos = null;
        S.enderecoId = novo.id;
        localStorage.setItem('sm_endereco', novo.id);
        S.ocupado = false;
        aviso(S.recemCriado ? 'Pronto! Bem-vindo à Solmedic+' : 'Endereço salvo');
        S.recemCriado = false;
        proximoModo = 'aba';
        vaiPara('inicio');
      } catch (err) {
        S.erro = err.message; S.ocupado = false; desenha(); aviso(err.message, { bom: false });
      }
    });
  }

  const campo = palco.querySelector('#q');
  if (campo && !campo.dataset.ligado) {
    campo.dataset.ligado = '1';
    let t;
    campo.addEventListener('input', () => {
      clearTimeout(t);
      const v = campo.value.trim();
      const alvo = telaAtual.querySelector('#resultados');
      if (v.length >= 2 && alvo) alvo.innerHTML = Array.from({ length: 3 }, () =>
        '<div class="esqueleto" style="height:100px;margin:0 18px 10px;border-radius:18px"></div>').join('');
      t = setTimeout(async () => {
        if (v.length < 2) { S.dados.busca = { q: v, itens: [] }; return atualizaResultados(); }
        await buscar(v);
        atualizaResultados();
      }, 300);
    });
  }

  const msg = palco.querySelector('#msg');
  if (msg && !msg.dataset.ligado) {
    msg.dataset.ligado = '1';
    msg.addEventListener('input', () => {
      msg.style.height = 'auto';
      msg.style.height = Math.min(110, msg.scrollHeight) + 'px';
    });
    msg.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); mandaMensagem(msg.value); }
    });
  }

  const arquivo = palco.querySelector('#arquivo');
  if (arquivo && !arquivo.dataset.ligado) {
    arquivo.dataset.ligado = '1';
    arquivo.addEventListener('change', () => { if (arquivo.files?.[0]) enviaReceita(arquivo.files[0]); });
  }
}

fone.addEventListener('click', async (e) => {
  const alvo = e.target.closest('[data-ir],[data-modo],[data-cats],[data-gps],[data-add],[data-qtd],[data-fechar],[data-enviar],[data-oferta],[data-cancelar],[data-filtro],[data-enderecos],[data-nota],[data-marca],[data-avaliar],[data-sair],[data-push],[data-detalhe],[data-instalar],[data-testar],[data-armario],[data-pergunta],[data-enviar-msg],[data-forma],[data-pix],[data-copiar],[data-sintoma]');
  if (!alvo || alvo.closest('.folha')) return;
  const d = alvo.dataset;

  if (d.add) {
    e.preventDefault(); e.stopPropagation();
    muda(d.add, 1);
    vibra(10);
    voaAoCarrinho(alvo);
    desenhaDoca();
    aviso('Adicionado ao carrinho');
    if (S.rota.split('/')[0] === 'carrinho') { proximoModo = 'nada'; return carrega('carrinho'); }
    return;
  }
  if (d.qtd) {
    e.preventDefault(); e.stopPropagation();
    const [ean, delta] = d.qtd.split(':');
    muda(ean, Number(delta)); vibra(6);
    proximoModo = 'nada';
    return carrega('carrinho');
  }
  if (d.nota) {
    e.preventDefault();
    S.dados.nota = Number(d.nota);
    S.dados.marcasEscolhidas = [];
    vibra(9);
    proximoModo = 'nada'; desenha();
    const acesa = telaAtual.querySelector(`[data-nota="${d.nota}"]`);
    acesa?.classList.add('pulou');
    return;
  }
  if (d.marca) {
    e.preventDefault();
    const m = d.marca;
    const lista = S.dados.marcasEscolhidas ?? [];
    S.dados.marcasEscolhidas = lista.includes(m) ? lista.filter((x) => x !== m) : [...lista, m];
    vibra(5);
    alvo.classList.toggle('on');
    return;
  }
  if (d.avaliar) {
    e.preventDefault();
    const comentario = telaAtual.querySelector('#comentario')?.value?.trim() || null;
    try {
      await api('POST', `/api/pedidos/${d.avaliar}/avaliar`, {
        nota: S.dados.nota, marcas: S.dados.marcasEscolhidas ?? [], comentario,
      });
      vibra(18);
      aviso('Avaliação enviada');
      proximoModo = 'nada';
      return carrega(`pedido/${d.avaliar}`);
    } catch (err) { return aviso(err.message, { bom: false }); }
  }
  if (d.copiar) {
    e.preventDefault();
    try { await navigator.clipboard.writeText(d.copiar); aviso('Código copiado'); vibra(12); }
    catch { aviso('Não consegui copiar — selecione o código à mão', { bom: false }); }
    return;
  }
  if (d.pix) {
    e.preventDefault();
    const [acao, oid] = d.pix.split(':');
    try {
      if (acao === 'gerar') {
        S.dados.pix = await api('POST', `/api/pedidos/${oid}/pix`);
        aviso('Código gerado');
      } else {
        await api('POST', `/api/pedidos/${oid}/pix/confirmar`, {});
        aviso('Pagamento confirmado');
        vibra(18);
        proximoModo = 'nada'; return carrega(`pedido/${oid}`);
      }
    } catch (err) { aviso(err.message, { bom: false }); }
    proximoModo = 'nada'; return desenha();
  }
  if (d.sintoma) {
    e.preventDefault();
    S.dados.busca = { q: '', carregando: true };
    proximoModo = 'nada'; desenha();
    const r = await api('GET', `/api/catalogo/busca?sintoma=${encodeURIComponent(d.sintoma)}`)
      .catch(() => ({ itens: [] }));
    S.dados.busca = { q: r.q ?? '', itens: r.itens ?? [], sintoma: r.sintoma };
    proximoModo = 'nada'; desenha();
    return;
  }
  if (d.forma) {
    e.preventDefault();
    S.pagamento = d.forma; localStorage.setItem('sm_pagamento', d.forma);
    vibra(7); proximoModo = 'nada'; return desenha();
  }
  if (d.pergunta) {
    e.preventDefault();
    if (S.rota.split('/')[0] !== 'conversa') {
      S.dados.perguntaPendente = d.pergunta;
      return vaiPara('conversa');
    }
    return mandaMensagem(d.pergunta);
  }
  if (d.enviarMsg) {
    e.preventDefault();
    return mandaMensagem(telaAtual?.querySelector('#msg')?.value);
  }
  if (d.push) {
    e.preventDefault();
    if (S.dados.pushLigado) {
      await avisos.desligaAvisos(api);
      S.dados.pushLigado = false;
      aviso('Avisos desligados neste aparelho');
    } else {
      const r = await ofereceAvisos({ forcado: true });
      S.dados.pushLigado = !!r?.ok;
    }
    proximoModo = 'nada'; return desenha();
  }
  if (d.detalhe) {
    e.preventDefault();
    const novo = !S.inicio?.user?.push_detalhado;
    const r = await api('PUT', '/api/conta/preferencias', { push_detalhado: novo }).catch(() => null);
    if (r) { S.inicio.user.push_detalhado = r.push_detalhado; S.eu.push_detalhado = r.push_detalhado; }
    vibra(8);
    aviso(novo ? 'Os avisos vão mostrar o nome do remédio' : 'Os avisos vão dizer só o número do pedido');
    proximoModo = 'nada'; return desenha();
  }
  if (d.armario) {
    e.preventDefault();
    const [acao, aid] = d.armario.split(':');
    const item = S.dados.armario?.itens.find((i) => i.id === aid);
    if (!item) return;
    try {
      if (acao === 'acabou') {
        await api('PUT', `/api/armario/${aid}`, { encerrar: true, motivo: 'acabou' });
        aviso('Tirado do armário');
      } else if (acao === 'resolvi') {
        await api('PUT', `/api/armario/${aid}`, { encerrar: true, motivo: 'descartado' });
        aviso('Ok — tirei do seu armário');
      } else {
        const n = item.qtd_atual + (acao === 'mais' ? 1 : -1);
        await api('PUT', `/api/armario/${aid}`, { qtd_atual: n });
      }
      vibra(7);
      S.dados.armario = await api('GET', '/api/armario');
      proximoModo = 'nada'; desenha();
    } catch (err) { aviso(err.message, { bom: false }); }
    return;
  }
  if (d.testar) {
    e.preventDefault();
    const r = await api('POST', '/api/notificacoes/testar', {}).catch(() => null);
    if (!r) return aviso('Não consegui enviar o teste', { bom: false });
    vibra(12);
    return;
  }
  if (d.instalar) {
    e.preventDefault();
    const foi = await avisos.instala();
    if (foi) { S.dados.instalado = true; aviso('Instalado! Procure o ícone na tela inicial.'); }
    proximoModo = 'nada'; return desenha();
  }
  if (d.sair) {
    e.preventDefault();
    const ok = await folha({ titulo: 'Sair da conta?',
      texto: 'Seus pedidos e receitas continuam guardados. É só entrar de novo.',
      acoes: [{ rotulo: 'Sair', tipo: 'principal', valor: true }, { rotulo: 'Ficar', valor: false }] });
    if (ok) sair();
    return;
  }
  /**
   * O convite de GPS na home.
   *
   * Se a pessoa já tem endereço, o que a localização faz é apurar o
   * ponto — então ela fica onde está e o app só guarda a coordenada.
   * Sem endereço, o GPS leva direto para o formulário já preenchido,
   * que é o passo que faltava.
   */
  if (d.gps) {
    e.preventDefault();
    const temEndereco = (S.dados.enderecos ?? []).length > 0;
    if (!temEndereco) { proximoModo = 'nada'; return vaiPara('endereco'); }
    const botao = alvo;
    botao.classList.add('ocupado');
    try {
      const pos = await new Promise((ok, nao) => navigator.geolocation.getCurrentPosition(ok, nao, {
        enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }));
      S.coord = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const atual = (S.dados.enderecos ?? []).find((x) => x.id === S.enderecoId)
        ?? S.dados.enderecos[0];
      if (atual) {
        await api('PUT', `/api/enderecos/${atual.id}`, S.coord).catch(() => {});
        S.dados.enderecos = null;
      }
      localStorage.setItem('sm_gps_ok', '1');
      aviso('Ponto de entrega apurado');
      proximoModo = 'nada'; desenha();
    } catch (err) {
      botao.classList.remove('ocupado');
      aviso(err?.code === 1
        ? 'Sem permissão de localização — dá para editar o endereço na mão'
        : 'Não consegui te localizar agora', { bom: false });
    }
    return;
  }
  if (d.cats) { e.preventDefault(); S.catsAbertas = !S.catsAbertas; proximoModo = 'nada'; return desenha(); }
  if (d.modo) {
    e.preventDefault();
    S.modoCadastro = d.modo === 'cadastro';
    S.erro = null; telaAtual = null; palco.innerHTML = '';
    return desenha();
  }
  if (d.enderecos) { e.preventDefault(); return escolheEndereco(); }
  if (d.fechar) { e.preventDefault(); return fechar(); }
  if (d.enviar) { e.preventDefault(); return palco.querySelector('#arquivo')?.click(); }
  if (d.filtro) {
    e.preventDefault();
    S.filtro = d.filtro; vibra(6);
    return atualizaResultados();
  }
  if (d.ir) { e.preventDefault(); return vaiPara(d.ir); }

  if (d.oferta) {
    e.preventDefault();
    const [id, aceitar] = d.oferta.split(':');
    const escolha = await folha({
      titulo: aceitar === '1' ? 'Aceitar a troca?' : 'Recusar e estornar?',
      texto: aceitar === '1'
        ? 'O substituto entra no lugar e a diferenca é ajustada na cobrança.'
        : 'O item sai do pedido e o valor volta para o seu cartão. O resto continua.',
      acoes: [{ rotulo: 'Confirmar', tipo: 'principal', valor: true }, { rotulo: 'Voltar', valor: false }],
    });
    if (!escolha) return;
    await api('POST', `/api/pedidos/${S.dados.pedido.id}/ofertas/${id}`, { aceitar: aceitar === '1' })
      .catch((err) => aviso(err.message, { bom: false }));
    proximoModo = 'nada';
    return carrega(`pedido/${S.dados.pedido.id}`);
  }
  if (d.cancelar) {
    e.preventDefault();
    const ok = await folha({
      titulo: 'Cancelar este pedido?',
      texto: 'A autorização no cartão é estornada e nada é cobrado. Você pode pedir de novo depois.',
      acoes: [{ rotulo: 'Sim, cancelar', tipo: 'principal', valor: true }, { rotulo: 'Manter o pedido', valor: false }],
    });
    if (!ok) return;
    await api('POST', `/api/pedidos/${d.cancelar}/cancelar`, { motivo: 'Cancelado pelo cliente' })
      .then(() => aviso('Pedido cancelado'))
      .catch((err) => aviso(err.message, { bom: false }));
    proximoModo = 'nada';
    return carrega(`pedido/${d.cancelar}`);
  }
});

/* ============ relógio e rodízio da busca ============ */
const PALAVRAS = ['dipirona', 'fralda P', 'vitamina D', 'protetor solar', 'sua receita', 'soro fisiológico'];
let iw = 0;
setInterval(() => {
  const alvo = document.getElementById('rodizio');
  if (!alvo) return;
  iw = (iw + 1) % PALAVRAS.length;
  alvo.style.transition = 'opacity .18s ease';
  alvo.style.opacity = '0';
  setTimeout(() => { alvo.textContent = PALAVRAS[iw]; alvo.style.opacity = '1'; }, 190);
}, 2600);
setInterval(() => {
}, 20000);

window.addEventListener('hashchange', () => {
  const nova = location.hash.slice(1) || 'inicio';
  if (nova !== S.rota) { proximoModo = 'pop'; S.rota = nova; carrega(nova); }
});

(async function boot() {
  avisos.registraServiceWorker();
  if (!sessionStorage.getItem('sm_abriu')) {
    abertura();
    sessionStorage.setItem('sm_abriu', '1');
  }
  if (!S.token) return desenha();
  try {
    S.eu = await api('GET', '/api/auth/eu');
    if (S.eu.anonimo) throw new Error('sessão expirada');
  } catch { return sair(); }
  ligaCanalPessoal();
  proximoModo = 'aba';
  carrega(S.rota);
  // a doca precisa do estado do pedido e da loja mesmo entrando por outra aba
  if (!S.rota.startsWith('inicio')) {
    api('GET', '/api/inicio').then((d) => { S.inicio = d; desenhaDoca(); }).catch(() => {});
  }
})();

/**
 * As advertências que a lei obriga.
 *
 * Não é texto decorativo: a frase do medicamento vem da RDC 96/2008, e a
 * do aleitamento materno da NBCAL (Lei 11.265/2006), que manda o aviso
 * aparecer em qualquer material de fórmula infantil, mamadeira e chupeta.
 * Farmácia que esquece disso toma multa — e, o que importa mais, engana
 * quem está decidindo com o filho no colo.
 */
function avisosLegais(p) {
  const avisos = [];
  const cat = p.categoria ?? '';
  const ehRemedio = !!p.principio_ativo && p.principio_ativo !== '—';

  if (cat === 'bebe' || /f[óo]rmula infantil|mamadeira|chupeta/i.test(p.nome ?? '')) {
    avisos.push({
      titulo: 'O Ministério da Saúde adverte:',
      texto: 'O aleitamento materno evita infecções e alergias e é recomendado '
        + 'até os dois anos de idade ou mais.',
    });
  }
  if (ehRemedio && !p.requer_receita) {
    avisos.push({
      titulo: 'O Ministério da Saúde adverte:',
      texto: 'Se os sintomas persistirem, o médico deverá ser consultado. '
        + 'Ao persistirem os sintomas, procure orientação de um profissional de saúde.',
    });
  }
  if (p.requer_receita) {
    avisos.push({
      titulo: 'Venda sob prescrição médica.',
      texto: p.retem_receita
        ? 'A receita fica retida na farmácia — o entregador recolhe a via com você.'
        : 'A receita é conferida pelo farmacêutico antes de o pedido ser separado.',
    });
  }
  return avisos;
}

/**
 * Pegar o endereço pelo GPS.
 *
 * É o atalho que faz diferença de verdade no cadastro: digitar rua,
 * número e bairro no celular, com pressa, é onde a maioria desiste.
 *
 * Três cuidados que a tela precisa ter e quase ninguém tem:
 *
 *   · o navegador só entrega a posição em HTTPS (localhost é exceção).
 *     Em HTTP o botão não some — ele explica;
 *   · a pessoa pode negar, e negar é uma resposta legítima: o formulário
 *     continua lá, preenchível na mão;
 *   · o endereço volta do Nominatim, serviço público do OpenStreetMap.
 *     Se ele falhar, as coordenadas já valem — a entrega chega no ponto
 *     certo mesmo com o nome da rua em branco.
 */
async function pegaLocalizacao(botao) {
  if (!navigator.geolocation) {
    return aviso('Este aparelho não informa a localização', { bom: false });
  }
  if (!window.isSecureContext) {
    return aviso('A localização só funciona em conexão segura (https)', { bom: false });
  }
  botao.classList.add('ocupado');
  botao.querySelector('b').textContent = 'Procurando você…';

  try {
    const pos = await new Promise((ok, nao) => navigator.geolocation.getCurrentPosition(ok, nao, {
      enableHighAccuracy: true, timeout: 12000, maximumAge: 60000,
    }));
    const { latitude: lat, longitude: lng } = pos.coords;
    S.coord = { lat, lng };

    const r = await fetch('https://nominatim.openstreetmap.org/reverse'
      + `?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      { headers: { 'Accept-Language': 'pt-BR' } }).then((x) => x.json()).catch(() => null);
    const a = r?.address ?? {};
    const bairro = a.suburb ?? a.neighbourhood ?? a.city_district ?? '';

    const põe = (id, v) => { const e = palco.querySelector('#' + id); if (e && v) e.value = v; };
    põe('logradouro', a.road);
    põe('numero', a.house_number);
    põe('cidade', a.city ?? a.town ?? a.municipality);
    põe('cep', a.postcode);
    põe('uf', (a['ISO3166-2-lvl4'] ?? '').replace('BR-', ''));

    // o bairro só entra se estiver na área atendida: escolher um bairro
    // que a gente não entrega seria empurrar o problema para o carrinho
    const sel = palco.querySelector('#bairro');
    const naArea = [...(sel?.options ?? [])].find((o) =>
      o.value.toLowerCase() === bairro.toLowerCase());
    if (sel && naArea) sel.value = naArea.value;

    botao.classList.remove('ocupado');
    botao.querySelector('b').textContent = 'Usar minha localização';
    if (bairro && !naArea) {
      aviso(`Você está em ${bairro}, fora da nossa área por enquanto`, { bom: false });
    } else {
      aviso(a.road ? `Achei: ${a.road}` : 'Localização capturada');
    }
  } catch (e) {
    botao.classList.remove('ocupado');
    botao.querySelector('b').textContent = 'Usar minha localização';
    aviso(e?.code === 1
      ? 'Sem permissão de localização — dá para preencher na mão'
      : 'Não consegui te localizar agora', { bom: false });
  }
}

/**
 * O farmacêutico na home.
 *
 * O bloco antigo era um cartão azul do tamanho de meia tela, com foto,
 * CRF, selo de online e um discurso em primeira pessoa. Ocupava o espaço
 * de uma oferta e falava como propaganda — que é exatamente o tom que
 * faz ninguém clicar.
 *
 * Isto aqui é uma barra. Diz o que resolve, mostra que tem gente com CRF
 * do outro lado, e sai da frente. A credencial vira uma linha pequena
 * porque é o que ela é: garantia, não manchete.
 */
function barraFarmaceutico() {
  const rt = S.dados.vitrine?.responsavel_tecnico;
  return `
  <button class="barra-farma" data-ir="conversa">
    <span class="av-farma">${esc(iniciais(rt?.nome ?? 'Farmácia'))}<i class="ponto-online"></i></span>
    <span class="tx">
      <b>Pode tomar junto? Qual genérico serve?</b>
      <span>${rt?.nome ? `${esc(rt.nome.split(' ')[0])} responde · ${esc(rt.crf ?? '')}` : 'Farmacêutico responde na hora'}</span>
    </span>
    <span class="ir-farma">${IC.balao}</span>
  </button>`;
}

/**
 * A cor de cada sintoma.
 *
 * Vinha da categoria, e por isso dor de cabeça, febre e enjoo saíam
 * vermelhos iguais — fileira monocromática, nada distinguível de
 * relance. Aqui cada um tem a sua, escolhida pelo que a pessoa associa:
 * febre é quente, gripe é fria, pele é areia.
 */
const COR_SINTOMA = {
  dor_cabeca: '#C0392B', febre: '#E8601C', gripe: '#2E8BC0', garganta: '#C7386B',
  azia: '#B8860B', enjoo: '#5B4FC4', pele: '#B07A4E', sol: '#E0A106',
  corte: '#1F9E7A', bebe: '#2E6BFF', imunidade: '#7A3BC7',
};
const corDoSintoma = (id, cat) => COR_SINTOMA[id] ?? (CATS[cat] ?? [])[1] ?? 'var(--brand)';

/**
 * A grade de categorias, na busca.
 *
 * Saiu da home porque lá ela respondia uma pergunta que ninguém faz
 * ("o que a farmácia vende?"). Aqui responde a pergunta certa: a pessoa
 * abriu a busca e não sabe o nome do que procura — então navega pela
 * prateleira.
 *
 * Fica fechada por padrão: quem já sabe o que quer digita, e a grade
 * aberta empurraria o resultado para fora da tela.
 */
function gradeCategorias() {
  const cats = (S.inicio?.categorias ?? []).filter((c) => CATS[c.categoria]);
  if (!cats.length) return '';
  return `
  <div class="gaveta-cat">
    ${cats.map((c) => {
      const [nome, cor] = CATS[c.categoria];
      return `<button class="cat-larga" data-ir="busca?cat=${c.categoria}" style="--c:${cor}">
        <span class="icone">${pictograma(c.categoria)}</span>
        <span class="tx"><b>${nome}</b><span>${c.n} ${c.n === 1 ? 'item' : 'itens'}</span></span>
        ${IC.seta}
      </button>`;
    }).join('')}
  </div>`;
}

/**
 * O convite para a localização, na home.
 *
 * O app nunca pedia — só perguntava lá dentro do cadastro de endereço,
 * onde quem chega pela primeira vez não passa. E endereço digitado
 * errado é a causa número um de entrega que não chega.
 *
 * Três formas, na ordem do quanto a pessoa já resolveu:
 *
 *   · não tem endereço → o cartão grande, que é o próximo passo dela;
 *   · tem endereço mas nunca deu GPS → uma linha discreta oferecendo
 *     apurar o ponto, porque o que ela tem já funciona;
 *   · já deu → nada. Pedir de novo é ruído.
 */
function cartaoLocalizacao(end) {
  if (S.coord || localStorage.getItem('sm_gps_ok')) return '';
  if (!end) {
    return `
    <button class="convite-gps grande" data-gps="1">
      <span class="anel-gps">
        <span class="onda"></span><span class="onda d2"></span>
        <span class="alfinete">${IC.local ?? ''}</span>
      </span>
      <span class="tx">
        <b>Onde você está?</b>
        <span>Deixa a gente achar sua rua — é um toque, e o entregador
          para na porta certa.</span>
      </span>
      <span class="cta-gps">Usar minha localização</span>
    </button>`;
  }
  return `
  <button class="convite-gps fina" data-gps="1">
    <span class="mini-alvo"></span>
    <span class="tx"><b>Apurar o ponto da entrega</b>
      <span>o GPS acerta o número e o complemento</span></span>
    ${IC.seta}
  </button>`;
}
