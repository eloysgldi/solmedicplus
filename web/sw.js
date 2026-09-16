/* ============================================================
   Service worker do Solmedic+
   Faz três coisas: instala o app na tela inicial, deixa o catálogo
   navegável sem rede, e recebe as notificações.
   ============================================================ */
const VERSAO = 'solmedic-v4';
const CASCA = ['/', '/index.html', '/app.css', '/app.js', '/pkg.js',
               '/marca.js', '/mapa.js', '/marca.svg', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/**
 * A API nunca vem do cache: preço, estoque e status de pedido errados são
 * pior que tela vazia.
 *
 * O resto era cache-primeiro, e isso tinha um defeito sério: uma vez que
 * app.js entrava no cache, a pessoa recebia aquela versão para sempre.
 * Subir correção no ar não mudava nada no aparelho de quem já tinha
 * aberto o app — o pior tipo de bug, porque some quando você testa numa
 * aba anônima.
 *
 * Agora é rede-primeiro com cache de reserva: online, sempre a versão
 * nova; sem sinal, abre com a última que funcionou. Um app de farmácia
 * precisa estar certo mais do que precisa abrir em 80 ms.
 */
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;

  e.respondWith((async () => {
    try {
      const r = await fetch(e.request);
      if (r.ok) {
        const copia = r.clone();
        caches.open(VERSAO).then((c) => c.put(e.request, copia));
      }
      return r;
    } catch {
      // sem rede: devolve o que tiver guardado, de qualquer versão
      const achou = await caches.match(e.request);
      return achou ?? Response.error();
    }
  })());
});

/* ---------- notificações ---------- */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titulo: e.data?.text() ?? '' }; }
  const opcoes = {
    body: d.corpo ?? '',
    icon: '/icone-192.png',
    badge: '/marca.svg',
    tag: d.tag ?? 'solmedic',
    renotify: !!d.renotify,
    requireInteraction: !!d.insistente,
    vibrate: d.insistente ? [180, 90, 180, 90, 260] : [60, 40, 60],
    data: { url: d.url ?? '/' },
    actions: d.acoes ?? [],
  };
  e.waitUntil(self.registration.showNotification(d.titulo ?? 'Solmedic+', opcoes));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = e.notification.data?.url ?? '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
    for (const j of janelas) {
      if (j.url.includes(location.origin)) { j.focus(); return j.navigate(destino); }
    }
    return self.clients.openWindow(destino);
  }));
});
