import { esc } from './painel-ui.js';
/**
 * ============================================================
 * A FROTA
 *
 * Aqui a loja cadastra quem leva, escolhe o veículo e — a decisão que
 * pesa — liga ou desliga o rastreamento daquele piloto.
 *
 * O rastreamento é por pessoa, não da loja inteira, porque a realidade é
 * essa: o entregador contratado aceita ser acompanhado, o autônomo que
 * faz duas corridas no fim de semana muitas vezes não. Uma chave só
 * obrigaria a escolher entre vigiar todo mundo ou ninguém.
 * ============================================================
 */

const VEICULO_ROT = { moto: 'Moto', bike: 'Bicicleta', carro: 'Carro', a_pe: 'A pé' };

export function telaFrota({ S }) {
  const lista = S.frota ?? [];
  const emTurno = lista.filter((c) => c.em_turno).length;

  return `
  <h1>Frota</h1>
  <p class="sub">Quem leva o pedido até a porta. O rastreamento é ligado por pessoa —
    e só vale enquanto ela estiver em turno.</p>

  <div class="grade-kpi">
    ${[['pilotos ativos', lista.filter((c) => c.ativo).length, ''],
       ['em turno agora', emTurno, emTurno ? 'rodando' : 'ninguém na rua'],
       ['rastreáveis', lista.filter((c) => c.rastreavel && c.ativo).length, 'o cliente acompanha'],
       ['entregas em 30d', lista.reduce((t, c) => t + (c.entregas_30d ?? 0), 0), '']]
      .map(([k, v, pe]) => `<div class="kpi-card"><div class="k">${k}</div>
        <div class="v">${v}</div><div class="pe">${pe}</div></div>`).join('')}
  </div>

  <div class="card bloco-frota">
    <header><div><div class="cod">novo piloto</div>
      <div class="nm">Cadastrar quem entrega</div></div></header>
    <div class="campos">
      ${campoF('nome', 'Nome', '', 'flex:2;min-width:180px')}
      ${campoF('telefone', 'Celular', '', 'width:160px')}
      <label class="campo" style="width:140px"><span class="rot">Veículo</span>
        <select class="ent" name="veiculo">
          ${Object.entries(VEICULO_ROT).map(([k, v]) =>
            `<option value="${k}">${v}</option>`).join('')}
        </select></label>
      ${campoF('placa', 'Placa', '', 'width:130px')}
      ${campoF('cnh', 'CNH', '', 'width:140px')}
    </div>
    <div class="campos">
      ${campoF('email', 'E-mail de acesso', '', 'flex:1;min-width:200px')}
      ${campoF('senha', 'Senha inicial', 'entrega123', 'width:160px')}
    </div>
    <div class="linha" style="padding:12px 16px 0;gap:16px;flex-wrap:wrap">
      <label class="fixar"><input type="checkbox" name="caixa_termica"> leva caixa térmica</label>
      <label class="fixar"><input type="checkbox" name="rastreavel" checked>
        rastreável — o cliente vê a moto no mapa</label>
      <button class="btn p sm" style="margin-left:auto" data-acao="salvar-piloto">Cadastrar</button>
    </div>
    <p class="fino" style="padding:10px 16px 16px;line-height:1.55">
      A conta de acesso é criada junto. O piloto entra em
      <code>/entregador.html</code> com esse e-mail e senha, e troca a senha depois.
      Sem e-mail, ele fica cadastrado mas não consegue usar o app.
    </p>
  </div>

  ${lista.length ? `
    <div class="card"><table>
      <tr><th>piloto</th><th>veículo</th><th>turno</th><th>rastreio</th>
          <th style="text-align:right">em rota</th><th style="text-align:right">30 dias</th><th></th></tr>
      ${lista.map((c) => `
        <tr class="${c.ativo ? '' : 'zerado'}">
          <td><b>${esc(c.nome)}</b>
            <span class="fino">${esc(c.telefone ?? '')}${c.email ? ` · ${esc(c.email)}` : ' · sem acesso ao app'}</span></td>
          <td>${esc(VEICULO_ROT[c.veiculo] ?? c.veiculo)}
            ${c.placa ? `<br><span class="fino mono">${esc(c.placa)}</span>` : ''}
            ${c.caixa_termica ? '<br><span class="pill">térmica</span>' : ''}</td>
          <td>${c.em_turno
            ? '<span class="pill" style="background:var(--save-bg);color:var(--save)">em turno</span>'
            : '<span class="pill">fora</span>'}</td>
          <td>
            <button class="chave-rastreio ${c.rastreavel ? 'on' : ''}"
              data-acao="rastreio" data-id="${esc(c.id)}"
              title="${c.rastreavel ? 'Desligar o rastreamento' : 'Ligar o rastreamento'}">
              <i></i>${c.rastreavel ? 'ligado' : 'desligado'}</button>
          </td>
          <td style="text-align:right" class="mono">${c.em_rota || '—'}</td>
          <td style="text-align:right" class="mono">${c.entregas_30d ?? 0}</td>
          <td style="text-align:right">
            <button class="btn g sm" data-acao="piloto-ativo" data-id="${esc(c.id)}">
              ${c.ativo ? 'Desativar' : 'Reativar'}</button></td>
        </tr>`).join('')}
    </table></div>` : '<div class="card"><div class="vazio">Nenhum piloto cadastrado.</div></div>'}`;
}

const campoF = (nome, rot, valor, estilo = '') => `
  <label class="campo" style="${estilo}">
    <span class="rot">${rot}</span>
    <input class="ent" name="${nome}" value="${esc(valor)}">
  </label>`;
