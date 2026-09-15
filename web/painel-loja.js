import { esc, brl } from './painel-ui.js';

/**
 * ============================================================
 * A LOJA
 *
 * Nome, endereço, frete e área de entrega deixam de ser constante no
 * código e viram campo. É o que separa um protótipo de um sistema: o
 * dono muda o próprio negócio sem pedir para ninguém.
 * ============================================================
 */

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function telaLoja({ S }) {
  const f = S.lojaDados ?? {};
  const cfg = S.config ?? {};
  const reais = (c) => ((c ?? 0) / 100).toFixed(2).replace('.', ',');

  return `
  <h1>A loja</h1>
  <p class="sub">O que está aqui aparece no app do cliente na hora. Sem reiniciar nada.</p>

  <div class="card bloco-loja">
    <header><div><div class="cod">identidade</div><div class="nm">Nome e contato</div></div></header>
    <div class="campos">
      ${campo('nome_fantasia', 'Nome que o cliente vê', f.nome_fantasia, 'flex:2;min-width:220px')}
      ${campo('telefone', 'Telefone', f.telefone, 'width:170px')}
      ${campo('email', 'E-mail', f.email, 'flex:1;min-width:200px')}
    </div>
    <div class="campos">
      ${campo('logradouro', 'Rua', f.logradouro, 'flex:2;min-width:200px')}
      ${campo('numero', 'Número', f.numero, 'width:110px')}
      ${campo('bairro', 'Bairro', f.bairro, 'width:170px')}
      ${campo('cidade', 'Cidade', f.cidade, 'width:170px')}
      ${campo('uf', 'UF', f.uf, 'width:80px')}
      ${campo('cep', 'CEP', f.cep, 'width:130px')}
    </div>
    <div class="rodape">
      <span class="fino">CNPJ ${esc(f.cnpj ?? '—')} · ${esc(f.razao_social ?? '')}
        — isso quem muda é a Receita, não esta tela.</span>
      <button class="btn p sm" style="margin-left:auto" data-acao="salvar-loja">Salvar</button>
    </div>
  </div>

  <div class="card bloco-loja">
    <header><div><div class="cod">entrega</div><div class="nm">Frete e alcance</div></div></header>
    <div class="campos">
      ${campo('frete_centavos', 'Frete (R$)', reais(f.frete_centavos), 'width:140px')}
      ${campo('frete_gratis_acima_centavos', 'Frete grátis acima de (R$)',
        reais(f.frete_gratis_acima_centavos), 'width:200px')}
      ${campo('raio_entrega_m', 'Raio de entrega (metros)', f.raio_entrega_m, 'width:190px')}
    </div>
    <div style="padding:0 16px 4px">
      <label class="rot">Bairros atendidos — um por linha</label>
      <textarea class="ent" name="area" rows="5"
        style="width:100%;font-family:var(--mono);font-size:12.5px">${esc((cfg.area ?? []).join('\n'))}</textarea>
      <p class="fino" style="margin:8px 0 0">Endereço fora desta lista recebe um aviso honesto
        no app, em vez de um pedido que ninguém vai entregar.</p>
    </div>
    <div class="rodape">
      <button class="btn p sm" style="margin-left:auto" data-acao="salvar-entrega">Salvar entrega</button>
    </div>
  </div>

  <div class="card bloco-loja">
    <header><div><div class="cod">funcionamento</div><div class="nm">Horários</div></div></header>
    <div class="horarios">
      ${DIAS.map((nome, d) => {
        const h = (S.horarios ?? []).find((x) => x.dia_semana === d) ?? {};
        return `
        <div class="dia" data-dia="${d}">
          <b>${nome}</b>
          <input class="ent" type="time" name="abre" value="${esc(h.abre ?? '08:00')}"
            ${h.fechado || h.is_24h ? 'disabled' : ''}>
          <span>às</span>
          <input class="ent" type="time" name="fecha" value="${esc(h.fecha ?? '22:00')}"
            ${h.fechado || h.is_24h ? 'disabled' : ''}>
          <label><input type="checkbox" name="is_24h" ${h.is_24h ? 'checked' : ''}> 24h</label>
          <label><input type="checkbox" name="fechado" ${h.fechado ? 'checked' : ''}> fechado</label>
        </div>`;
      }).join('')}
    </div>
    <div class="rodape">
      <button class="btn p sm" style="margin-left:auto" data-acao="salvar-horarios">Salvar horários</button>
    </div>
  </div>

  ${S.eu?.papel_global === 'admin' ? blocoInterruptores(cfg) : ''}`;
}

const campo = (nome, rot, valor, estilo = '') => `
  <label class="campo" style="${estilo}">
    <span class="rot">${rot}</span>
    <input class="ent" name="${nome}" value="${esc(valor ?? '')}">
  </label>`;

/**
 * Os interruptores que mudam o que a plataforma é.
 * Ficam atrás do papel de admin porque ligar receita sem licença é crime,
 * não configuração.
 */
function blocoInterruptores(cfg) {
  return `
  <div class="card bloco-loja">
    <header><div><div class="cod">plataforma</div><div class="nm">Interruptores</div></div>
      <span class="pill critico">admin</span></header>
    <div style="padding:16px">
      <label class="chave">
        <input type="checkbox" name="receita_habilitada" ${cfg.receita_habilitada ? 'checked' : ''}>
        <span><b>Aviar receita</b>
          Liga tarja vermelha e preta no catálogo. Só ligue com a licença sanitária
          e o farmacêutico responsável em dia.</span>
      </label>
      <label class="chave">
        <input type="checkbox" name="pix_habilitado" ${cfg.pix_habilitado !== false ? 'checked' : ''}>
        <span><b>Aceitar PIX</b>
          A opção mais barata para a casa: não tem a mordida da bandeira.</span>
      </label>
      <div class="linha" style="margin-top:12px;gap:8px">
        <input class="ent" name="pix_chave" placeholder="Chave PIX (vazio usa o CNPJ)"
          value="${esc(cfg.pix_chave ?? '')}" style="flex:1">
        <button class="btn p sm" data-acao="salvar-config">Salvar</button>
      </div>
    </div>
  </div>`;
}
