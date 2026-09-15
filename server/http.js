/** Roteador mínimo. Sem framework — o Node 24 já dá conta. */
export class Erro extends Error {
  constructor(status, code, msg) { super(msg || code); this.status = status; this.code = code; }
}

export function rotas() {
  const tabela = [];
  const add = (metodo) => (padrao, fn) => {
    const partes = padrao.split('/').filter(Boolean);
    tabela.push({ metodo, partes, fn });
  };
  return {
    get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), del: add('DELETE'),
    casa(metodo, caminho) {
      const partes = caminho.split('/').filter(Boolean);
      for (const r of tabela) {
        if (r.metodo !== metodo || r.partes.length !== partes.length) continue;
        const params = {};
        let ok = true;
        for (let i = 0; i < partes.length; i++) {
          const p = r.partes[i];
          if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(partes[i]);
          else if (p !== partes[i]) { ok = false; break; }
        }
        if (ok) return { fn: r.fn, params };
      }
      return null;
    },
  };
}

export async function corpo(req) {
  const pedacos = [];
  for await (const c of req) pedacos.push(c);
  if (!pedacos.length) return {};
  try { return JSON.parse(Buffer.concat(pedacos).toString('utf8')); }
  catch { throw new Erro(400, 'JSON_INVALIDO', 'Corpo da requisição não é JSON válido'); }
}

export function json(res, status, dados) {
  const txt = JSON.stringify(dados);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(txt);
}
