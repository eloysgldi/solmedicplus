import { esc, brl } from './painel-ui.js';

/**
 * ============================================================
 * A FICHA DO PRODUTO
 *
 * Aqui o dono cadastra o que vende: nome, foto, descrição, preço, preço
 * promocional, tarja, estoque — tudo numa tela só.
 *
 * Três decisões que a tela toma por ele, porque errar nelas custa caro:
 *
 *   · tarja vermelha liga "exige receita" sozinha e não deixa desligar.
 *     Vender tarjado sem receita não é opção de configuração;
 *   · o preço promocional é o "de", riscado. A tela mostra o desconto em
 *     tempo real, porque promoção que não parece promoção não vende;
 *   · o PMC é opcional, mas quando preenchido vira teto: o sistema
 *     recusa preço acima dele, que é o que a CMED exige.
 * ============================================================
 */

const CATEGORIAS = [
  ['dor', 'Dor e febre'], ['gripe', 'Gripe e resfriado'], ['pressao', 'Pressão e coração'],
  ['antibiotico', 'Antibiótico'], ['dermo', 'Dermocosmético'], ['vitaminas', 'Vitaminas'],
  ['bebe', 'Mamães e bebês'], ['higiene', 'Higiene e cuidado'],
  ['refrigerado', 'Refrigerado'], ['outros', 'Outros'],
];

const reais = (c) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');

export function telaProdutoLoja({ S }) {
  const p = S.produtoEdit ?? {};
  const novo = !p.ean;
  const off = p.preco_de_centavos && p.preco_centavos && p.preco_de_centavos > p.preco_centavos
    ? Math.round((1 - p.preco_centavos / p.preco_de_centavos) * 100) : 0;

  return `
  <div class="volta-linha">
    <button class="btn g sm" data-acao="fechar-produto">← Catálogo</button>
  </div>

  <h1>${novo ? 'Novo produto' : esc(p.nome)}</h1>
  <p class="sub">${novo
    ? 'O código de barras identifica o produto. Se ele já existir no catálogo, você edita em vez de duplicar.'
    : 'O que você mudar aqui aparece no app do cliente na hora.'}</p>

  <div class="ficha-produto">
    <div class="col-foto">
      <div class="foto-grande">
        ${p.imagem_url ? `<img src="${esc(p.imagem_url)}" alt="">`
          : '<span class="sem-foto-painel">sem foto</span>'}
        ${p.ean ? `
          <label class="trocar-foto">${p.imagem_url ? 'trocar foto' : 'subir foto'}
            <input type="file" accept="image/jpeg,image/png,image/webp"
                   data-foto="${esc(p.ean)}" hidden></label>
          ${p.imagem_url ? `<button class="tirar-foto" data-acao="apagar-foto-prod"
            data-ean="${esc(p.ean)}">remover</button>` : ''}`
          : '<p class="fino" style="text-align:center">Salve primeiro para poder subir a foto.</p>'}
      </div>

      ${p.preco_centavos ? `
        <div class="espelho-preco">
          <span class="cod">como o cliente vê</span>
          <div class="preco-vitrine">
            <b>${brl(p.preco_centavos)}</b>
            ${off ? `<span class="de">${brl(p.preco_de_centavos)}</span>
                     <span class="off">−${off}%</span>` : ''}
          </div>
        </div>` : ''}
    </div>

    <div class="col-campos bloco-produto">
      <div class="grupo-campo"><h3>Identificação</h3>
        <div class="campos">
          ${campo('ean', 'Código de barras (EAN)', p.ean, 'width:200px',
            novo ? '' : 'readonly')}
          ${campo('nome', 'Nome que aparece na vitrine', p.nome, 'flex:2;min-width:240px')}
        </div>
        <div class="campos">
          ${campo('marca', 'Marca', p.marca, 'width:170px')}
          ${campo('fabricante', 'Fabricante', p.fabricante, 'width:180px')}
          ${campo('apresentacao', 'Apresentação', p.apresentacao, 'flex:1;min-width:170px')}
        </div>
        <div style="padding:0 16px 14px">
          <label class="rot">Descrição — é o texto que o cliente lê na página do produto</label>
          <textarea class="ent" name="descricao" rows="4"
            placeholder="Para que serve, como usar, o que tem de diferente."
            style="width:100%">${esc(p.descricao ?? '')}</textarea>
        </div>
      </div>

      <div class="grupo-campo"><h3>Preço</h3>
        <div class="campos">
          ${campo('preco_centavos', 'Preço de venda (R$)', reais(p.preco_centavos), 'width:160px')}
          ${campo('preco_de_centavos', 'Preço "de" — o riscado (R$)',
            reais(p.preco_de_centavos), 'width:190px')}
          ${campo('pmc_centavos', 'PMC da CMED (R$)', reais(p.pmc_centavos), 'width:170px')}
        </div>
        <p class="fino" style="padding:0 16px 14px">
          O "de" tem que ser maior que o de venda — senão não é promoção, é aumento.
          Com o PMC preenchido, o sistema recusa preço acima dele.
        </p>
      </div>

      <div class="grupo-campo"><h3>Classificação</h3>
        <div class="campos">
          <label class="campo" style="width:190px"><span class="rot">Categoria</span>
            <select class="ent" name="categoria">
              ${CATEGORIAS.map(([k, v]) =>
                `<option value="${k}" ${p.categoria === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select></label>
          <label class="campo" style="width:170px"><span class="rot">Tarja</span>
            <select class="ent" name="tarja">
              <option value="livre" ${p.tarja !== 'vermelha' ? 'selected' : ''}>Venda livre</option>
              <option value="vermelha" ${p.tarja === 'vermelha' ? 'selected' : ''}>Tarja vermelha</option>
            </select></label>
          ${campo('principio_ativo', 'Princípio ativo', p.principio_ativo, 'flex:1;min-width:170px')}
          ${campo('dosagem', 'Dosagem', p.dosagem, 'width:130px')}
        </div>
        <div class="linha" style="padding:10px 16px 14px;gap:18px;flex-wrap:wrap">
          <label class="fixar"><input type="checkbox" name="generico"
            ${p.generico ? 'checked' : ''}> genérico</label>
          <label class="fixar"><input type="checkbox" name="refrigerado"
            ${p.refrigerado ? 'checked' : ''}> precisa de caixa térmica</label>
          <label class="fixar"><input type="checkbox" name="retem_receita"
            ${p.retem_receita ? 'checked' : ''}> retém a receita</label>
        </div>
      </div>

      <div class="grupo-campo"><h3>Na sua prateleira</h3>
        <div class="campos">
          ${campo('estoque', 'Estoque', p.estoque ?? 0, 'width:120px')}
          ${campo('posicao', 'Posição (corredor)', p.posicao, 'width:160px')}
          ${campo('registro_ms', 'Registro MS', p.registro_ms, 'width:180px')}
        </div>
      </div>

      <div class="rodape">
        ${!novo ? `<button class="btn d sm" data-acao="arquivar-produto" data-ean="${esc(p.ean)}">
          ${p.ativo_na_loja === 0 ? 'Devolver à vitrine' : 'Tirar da vitrine'}</button>` : ''}
        <button class="btn p" style="margin-left:auto" data-acao="salvar-produto">
          ${novo ? 'Cadastrar produto' : 'Salvar alterações'}</button>
      </div>
    </div>
  </div>`;
}

const campo = (nome, rot, valor, estilo = '', extra = '') => `
  <label class="campo" style="${estilo}">
    <span class="rot">${rot}</span>
    <input class="ent" name="${nome}" value="${esc(valor ?? '')}" ${extra}>
  </label>`;
