import { um, todos } from './db.js';

/**
 * ============================================================
 * Alerta de interação e duplicidade.
 *
 * Isto é o que só uma farmácia consegue fazer: a gente sabe o que a
 * pessoa comprou. Se ela levou dipirona anteontem e agora está levando
 * Dorflex, os dois têm dipirona — e ninguém avisa isso num marketplace.
 *
 * Duas regras, e a fronteira entre elas importa:
 *   AVISO  — a gente mostra e a pessoa decide. Nunca bloqueia a compra.
 *   Nada aqui é diagnóstico. É conferência de rótulo, que é o trabalho
 *   do balcão desde sempre.
 * ============================================================
 */

/** Pares que não combinam. Lista curta e defensável, não enciclopédia. */
export const PARES = [
  { a: 'Ibuprofeno', b: 'Ácido acetilsalicílico',
    texto: 'Anti-inflamatório junto com AAS aumenta o risco de irritação no estômago.' },
  { a: 'Ibuprofeno', b: 'Dipirona sódica',
    texto: 'Dois analgésicos ao mesmo tempo: costuma ser desnecessário e sobrecarrega.' },
  { a: 'Paracetamol', b: 'Dipirona sódica',
    texto: 'Os dois baixam febre. Juntos, sem orientação, é dose dobrada sem ganho.' },
];

/** Quantos dias para trás o histórico ainda conta como "está tomando". */
const JANELA_DIAS = 7;

const normaliza = (s) => String(s ?? '').toLowerCase().trim();

/**
 * Olha o carrinho contra ele mesmo e contra o que a pessoa comprou
 * nos últimos dias. Devolve avisos, nunca bloqueios.
 */
export function confere(userId, eans = []) {
  if (!eans.length) return [];
  const produtos = eans.map((e) => um('SELECT * FROM products WHERE ean = ?', e)).filter(Boolean);

  const recentes = userId ? todos(
    `SELECT DISTINCT p.ean, p.nome, p.principio_ativo, MAX(o.entregue_em) AS quando
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id AND o.user_id = ? AND o.status = 'entregue'
       JOIN products p ON p.ean = oi.ean
      WHERE o.entregue_em >= datetime('now', ?)
      GROUP BY p.ean`, userId, `-${JANELA_DIAS} days`) : [];

  const avisos = [];

  // 1. o mesmo princípio ativo duas vezes — no carrinho ou vindo de trás
  const vistos = new Map();
  for (const p of produtos) {
    const pa = normaliza(p.principio_ativo);
    if (!pa || pa === '—') continue;
    if (vistos.has(pa)) {
      avisos.push({
        nivel: 'duplicado',
        titulo: 'Mesmo princípio ativo duas vezes',
        texto: `${vistos.get(pa)} e ${p.nome} têm ${p.principio_ativo}. `
          + 'Levar os dois é dobrar a dose sem perceber.',
        produtos: [vistos.get(pa), p.nome],
      });
    } else vistos.set(pa, p.nome);

    const antes = recentes.find((r) => normaliza(r.principio_ativo) === pa && r.ean !== p.ean);
    if (antes) {
      avisos.push({
        nivel: 'recente',
        titulo: 'Você já tem isso em casa',
        texto: `${antes.nome}, que você recebeu há pouco, tem o mesmo ${p.principio_ativo} `
          + `de ${p.nome}.`,
        produtos: [antes.nome, p.nome],
      });
    }
  }

  // 2. pares que não combinam, entre o carrinho e o histórico recente
  const todosPA = [
    ...produtos.map((p) => ({ nome: p.nome, pa: normaliza(p.principio_ativo) })),
    ...recentes.map((r) => ({ nome: r.nome, pa: normaliza(r.principio_ativo), antigo: true })),
  ];
  for (const par of PARES) {
    const x = todosPA.find((t) => t.pa.includes(normaliza(par.a)));
    const y = todosPA.find((t) => t.pa.includes(normaliza(par.b)));
    if (x && y && x.nome !== y.nome) {
      avisos.push({
        nivel: 'interacao',
        titulo: 'Esses dois pedem atenção',
        texto: `${x.nome} e ${y.nome}: ${par.texto}`,
        produtos: [x.nome, y.nome],
      });
    }
  }

  // sem repetir o mesmo aviso duas vezes
  const chave = (a) => a.nivel + a.produtos.slice().sort().join('|');
  return [...new Map(avisos.map((a) => [chave(a), a])).values()];
}
