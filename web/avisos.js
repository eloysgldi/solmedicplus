/* ============================================================
   Avisos no navegador: service worker, permissão e inscrição.

   A permissão NÃO é pedida na abertura. Pedir push antes de a pessoa
   ter qualquer motivo para querer é a forma mais rápida de levar um
   "bloquear" definitivo. A gente pede depois do primeiro pedido, que
   é quando o aviso passa a servir para alguma coisa.
   ============================================================ */

const b64ParaBytes = (b64) => {
  const p = '='.repeat((4 - (b64.length % 4)) % 4);
  const cru = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...cru].map((c) => c.charCodeAt(0)));
};

let registro = null;

export async function registraServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    registro = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return registro;
  } catch { return null; }
}

export const podePush = () =>
  'Notification' in window && 'PushManager' in window && !!registro;

export const estadoDaPermissao = () =>
  'Notification' in window ? Notification.permission : 'indisponivel';

/**
 * Pede a permissão e inscreve. Devolve o motivo quando não dá, para
 * a tela poder explicar em vez de só falhar em silêncio.
 */
export async function ligaAvisos(api) {
  if (!('Notification' in window)) return { ok: false, motivo: 'Este navegador não faz notificação' };

  if (Notification.permission === 'denied') {
    return { ok: false, motivo: 'Você bloqueou os avisos. Libere nas configurações do navegador.' };
  }
  if (Notification.permission !== 'granted') {
    const r = await Notification.requestPermission();
    if (r !== 'granted') return { ok: false, motivo: 'Sem permissão, tudo bem — o app avisa por dentro.' };
  }

  // Sem service worker não há push (o app fechado não recebe), mas com a
  // permissão dada o aviso do sistema já funciona enquanto o app está aberto.
  // Metade do valor, zero de dependência — e é o que vale em quase toda
  // sessão, porque a pessoa fica com o app aberto esperando a entrega.
  if (!registro) await registraServiceWorker();
  if (!registro) {
    return { ok: true, modo: 'local',
      motivo: 'Avisos ligados neste aparelho enquanto o app estiver aberto.' };
  }

  try {
    const { chave } = await api('GET', '/api/push/chave');
    const ja = await registro.pushManager.getSubscription();
    const inscricao = ja ?? await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ParaBytes(chave),
    });
    const j = inscricao.toJSON();
    await api('POST', '/api/push/inscrever', {
      endpoint: j.endpoint, keys: j.keys, aparelho: navigator.userAgent.slice(0, 120),
    });
    return { ok: true, modo: 'push' };
  } catch {
    // push indisponível não derruba o aviso local
    return { ok: true, modo: 'local',
      motivo: 'Avisos ligados. Com o app fechado, só no navegador que aceita push.' };
  }
}

/**
 * Aviso do sistema sem service worker. Funciona com o app aberto — que é
 * o caso de quase toda sessão em que o aviso importa.
 */
export function avisaLocal({ titulo, corpo, url }) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const n = new Notification(titulo, {
      body: corpo ?? '', icon: '/logo.png', badge: '/marca.svg',
      tag: 'solmedic', silent: false,
    });
    n.onclick = () => { window.focus(); if (url) location.hash = url.replace('/#', ''); n.close(); };
    setTimeout(() => n.close(), 9000);
    return true;
  } catch { return false; }
}

export const permitido = () =>
  'Notification' in window && Notification.permission === 'granted';

export async function desligaAvisos(api) {
  const i = registro && await registro.pushManager.getSubscription();
  if (!i) return;
  await api('POST', '/api/push/sair', { endpoint: i.endpoint }).catch(() => {});
  await i.unsubscribe().catch(() => {});
}

/** Canal pessoal: o aviso chega dentro do app mesmo sem push. */
/**
 * O canal pessoal.
 *
 * Carrega dois tipos de recado no mesmo cano: o aviso que vira toast e
 * sininho, e a posição do entregador. Abrir um segundo EventSource só
 * para a moto seria uma segunda conexão aberta o dia inteiro, gastando
 * bateria do cliente para transportar dois números.
 */
export function ouveAvisos(token, aoChegar, aoMover) {
  if (!token) return () => {};
  const fonte = new EventSource(`/api/notificacoes/stream?t=${encodeURIComponent(token)}`);
  fonte.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data);
      if (d.tipo === 'notificacao') aoChegar(d.notificacao);
      else if (d.tipo === 'entregador_moveu') aoMover?.(d);
    } catch {}
  };
  return () => fonte.close();
}

/* ---------- instalar na tela inicial ---------- */
let convite = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); convite = e; });

export const podeInstalar = () => !!convite;
export const jaInstalado = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export async function instala() {
  if (!convite) return false;
  convite.prompt();
  const { outcome } = await convite.userChoice;
  convite = null;
  return outcome === 'accepted';
}
