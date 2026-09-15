import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { r } from './api.js';
import { json } from './http.js';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const WEB = join(raiz, 'web');
const PORTA = Number(process.env.PORT || 4173);

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

async function estatico(res, caminho) {
  // join() já normaliza '..'; o startsWith abaixo barra qualquer fuga do diretório web/
  const alvo = join(WEB, caminho);
  if (!alvo.startsWith(WEB)) { res.writeHead(403).end('Fora do diretório'); return true; }
  try {
    const info = await stat(alvo);
    const arquivo = info.isDirectory() ? join(alvo, 'index.html') : alvo;
    const buf = await readFile(arquivo);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(arquivo)] || 'application/octet-stream' });
    res.end(buf);
    return true;
  } catch { return false; }
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    }).end();
    return;
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (url.pathname.startsWith('/api/')) {
    const rota = r.casa(req.method, url.pathname);
    if (!rota) return json(res, 404, { erro: 'ROTA_INEXISTENTE', mensagem: `${req.method} ${url.pathname} não existe` });
    try {
      await rota.fn(req, res, rota.params, url);
    } catch (e) {
      if (res.headersSent) return;
      const status = e.status ?? 500;
      if (status === 500) console.error('[erro]', e);
      json(res, status, { erro: e.code ?? 'ERRO_INTERNO', mensagem: e.message });
    }
    return;
  }

  // fotos de produto enviadas pela loja
  if (url.pathname.startsWith('/fotos/')) {
    const alvo = join(raiz, 'data', url.pathname);
    if (!alvo.startsWith(join(raiz, 'data', 'fotos'))) { res.writeHead(403).end(); return; }
    try {
      const buf = await readFile(alvo);
      res.writeHead(200, { 'Content-Type': TIPOS[extname(alvo)] || 'application/octet-stream',
                           'Cache-Control': 'public, max-age=86400' });
      res.end(buf); return;
    } catch { res.writeHead(404).end('não encontrado'); return; }
  }
  // arquivos enviados pelos usuários (receitas, documentos da loja)
  if (url.pathname.startsWith('/uploads/')) {
    const alvo = join(raiz, 'data', url.pathname);
    if (!alvo.startsWith(join(raiz, 'data', 'uploads'))) { res.writeHead(403).end(); return; }
    try {
      const buf = await readFile(alvo);
      res.writeHead(200, { 'Content-Type': TIPOS[extname(alvo)] || 'application/octet-stream',
                           'Cache-Control': 'private, max-age=60' });
      res.end(buf); return;
    } catch { res.writeHead(404).end('não encontrado'); return; }
  }

  if (await estatico(res, url.pathname === '/' ? '/index.html' : url.pathname)) return;

  // Só caminho SEM extensão cai no app. Antes, um /logo.png inexistente
  // recebia o index.html com status 200 — e quem fosse checar se o arquivo
  // existe concluía que sim.
  if (!extname(url.pathname) && await estatico(res, '/index.html')) return;
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('não encontrado');
});

servidor.listen(PORTA, () => {
  console.log(`\n  Solmedic+ no ar`);
  console.log(`  app do cliente   http://localhost:${PORTA}`);
  console.log(`  painel da loja   http://localhost:${PORTA}/painel.html`);
  console.log(`  apresentação     http://localhost:${PORTA}/pitch.html  (a antiga, ainda em verde)`);
  console.log(`  api              http://localhost:${PORTA}/api/farmacias\n`);
});
