/* ============================================================
   SOLMEDIC+  ·  identidade

   O símbolo são duas cápsulas em simetria de 180°, formando o S.
   Cápsula porque é farmácia; S porque é o nome; e o encaixe entre as
   duas dá o movimento de quem leva uma coisa de um lugar a outro.

   O "+" não sumiu: ele virou a marca do plano. Símbolo é o S,
   sinal é o +, e cada um tem um trabalho.
   ============================================================ */

/* As duas cápsulas, em quadro quadrado de 100×100.
   A simetria é de 180° em torno do centro (50, 50): a segunda cápsula é
   exatamente a primeira virada de ponta-cabeça, e é isso que dá o encaixe. */
const CAPSULA_A = 'M53.5 28.5 C53.5 43.5 34 39.5 27.7 50.5';
const CAPSULA_B = 'M46.5 71.5 C46.5 56.5 66 60.5 72.3 49.5';
/* halteres: ponta grossa, cintura fina — é isso que dá o peso da marca */
const PONTA = 10.8, CINTURA = 13.5;
const PONTAS = [[53.5, 28.5], [27.7, 50.5], [46.5, 71.5], [72.3, 49.5]];

/**
 * Se existir web/logo.png, é ele que vale — arquivo do dono ganha do
 * meu vetor. O vetor fica de reserva, para quando o PNG não estiver lá.
 */
export const TEM_PNG = await fetch('/logo.png', { method: 'HEAD' })
  .then((r) => r.ok).catch(() => false);

let seq = 0;

/**
 * A marca. `cheia` desenha o quadrado azul; senão saem só as cápsulas
 * na cor corrente — é assim que ela vira marca d'água.
 */
export function marca({ tam = 40, cheia = true, id = 'm' + (++seq) } = {}) {
  if (TEM_PNG && cheia) {
    // O PNG vem com margem transparente em volta do quadrado (o ícone ocupa
    // 1012 de 1254). A gente recorta essa margem para a marca encostar nas
    // bordas da caixa, como qualquer outro ícone de app.
    return `<span class="marca-png" style="width:${tam}px;height:${tam}px;
      border-radius:${(tam * 0.26).toFixed(1)}px">
      <img src="/logo.png" alt="Solmedic+"></span>`;
  }
  const traco = cheia ? `url(#c${id})` : 'currentColor';
  return `
  <svg width="${tam}" height="${tam}" viewBox="0 0 100 100" aria-label="Solmedic+" role="img">
    ${cheia ? `<defs>
      <linearGradient id="g${id}" x1="1" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0B6CF7"/><stop offset="1" stop-color="#1B40E6"/>
      </linearGradient>
      <linearGradient id="c${id}" x1=".2" y1="0" x2=".8" y2="1">
        <stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#EAF1FF"/>
      </linearGradient>
    </defs>
    <rect width="100" height="100" rx="28" fill="url(#g${id})"/>` : ''}
    <g fill="${traco}" stroke="${traco}">
      <g fill="none" stroke-width="${CINTURA}" stroke-linecap="round">
        <path d="${CAPSULA_A}"/><path d="${CAPSULA_B}"/>
      </g>
      ${PONTAS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${PONTA}" stroke="none"/>`).join('')}
    </g>
  </svg>`;
}

/** Logotipo com o nome. O "+" final é o sinal do plano, em azul vivo. */
export function logotipo({ tam = 22, cor = 'currentColor' } = {}) {
  return `<span class="logotipo" style="font-size:${tam}px;color:${cor}">Solmedic<b>+</b></span>`;
}

/** O "+" solto: selo de plano, miolo de botão, preço com desconto de membro. */
export const sinal = (tam = 14) => `
  <svg width="${tam}" height="${tam}" viewBox="0 0 48 48" aria-hidden="true">
    <rect x="9" y="20" width="30" height="8" rx="4" fill="currentColor"/>
    <rect x="20" y="9" width="8" height="30" rx="4" fill="currentColor"/>
  </svg>`;

/** Abertura: as duas cápsulas se desenham, uma depois da outra. */
export function abertura() {
  const el = document.createElement('div');
  el.className = 'abertura';
  el.innerHTML = `
    <div class="abertura-centro">
      <svg width="92" height="92" viewBox="0 0 100 100" class="abertura-marca" aria-hidden="true">
        <g fill="none" stroke="#fff" stroke-width="${CINTURA}" stroke-linecap="round">
          <path class="capsula a" d="${CAPSULA_A}" pathLength="100"/>
          <path class="capsula b" d="${CAPSULA_B}" pathLength="100"/>
        </g>
        <g fill="#fff">${PONTAS.map(([x, y], i) =>
          `<circle class="ponta p${i}" cx="${x}" cy="${y}" r="${PONTA}"/>`).join('')}</g>
      </svg>
      <div class="abertura-nome">Solmedic<b>+</b></div>
      <div class="abertura-lema">o remédio certo, sempre</div>
    </div>`;
  document.body.appendChild(el);
  setTimeout(() => {
    el.classList.add('saindo');
    setTimeout(() => el.remove(), 520);
  }, 1500);
  return el;
}
