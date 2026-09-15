/**
 * Barramento de eventos em memória + SSE.
 * É o que faz o pedido cair no tablet da farmácia sozinho,
 * e a tela do cliente andar sem dar F5.
 * Em produção com mais de um processo, trocar por Redis pub/sub.
 */
const canais = new Map();   // canal -> Set<res>

export function inscreve(canal, res) {
  if (!canais.has(canal)) canais.set(canal, new Set());
  canais.get(canal).add(res);
  return () => {
    canais.get(canal)?.delete(res);
    if (canais.get(canal)?.size === 0) canais.delete(canal);
  };
}

export function publica(canal, dados) {
  const ouvintes = canais.get(canal);
  if (!ouvintes) return 0;
  const linha = `data: ${JSON.stringify(dados)}\n\n`;
  for (const res of ouvintes) { try { res.write(linha); } catch {} }
  return ouvintes.size;
}

export function abreSSE(req, res, canal) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify({ tipo: 'conectado', canal })}\n\n`);
  const cancela = inscreve(canal, res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(ping); cancela(); });
}

export const ouvintesDe = (canal) => canais.get(canal)?.size ?? 0;
