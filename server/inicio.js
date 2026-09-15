import { um, todos } from './db.js';
import { CONFIG, lojaDaCasa, filtroReceita } from './config.js';
import * as armario from './armario.js';

/**
 * Tudo que a primeira tela precisa, numa chamada só.
 * Home de app não pode fazer seis round-trips antes de aparecer.
 */
export function monta(user) {
  const endereco = user
    ? um('SELECT * FROM addresses WHERE user_id = ? ORDER BY padrao DESC LIMIT 1', user.id)
    : null;

  // não existe escolher farmácia: a farmácia somos nós
  const loja = lojaDaCasa();

  const socio = !!user?.socio;
  const preco = (i) => (socio && i.preco_socio_centavos ? i.preco_socio_centavos : i.preco_centavos);

  // ofertas: só o que tem preço "de" maior que o preço atual
  const ofertas = todos(
    `SELECT p.*, i.preco_centavos, i.preco_socio_centavos, i.preco_de_centavos, i.estoque
       FROM inventory i JOIN products p ON p.ean = i.ean
      WHERE i.pharmacy_id = ? AND i.ativo = 1 AND i.estoque > 0
        AND i.preco_de_centavos IS NOT NULL AND i.preco_de_centavos > i.preco_centavos
        AND p.controlado_344 = 0 ${filtroReceita()}
      ORDER BY (CAST(i.preco_de_centavos - i.preco_centavos AS REAL) / i.preco_de_centavos) DESC
      LIMIT 8`, loja?.id ?? '');

  // "comprar de novo": receita com saldo primeiro, depois histórico de compra
  const continuos = (user && CONFIG.receita_habilitada) ? todos(
    `SELECT p.*, pi.qtd_prescrita, pi.qtd_usada,
            (pi.qtd_prescrita - pi.qtd_usada) AS saldo, r.id AS prescription_id
       FROM prescription_items pi
       JOIN prescriptions r ON r.id = pi.prescription_id
       JOIN products p ON p.ean = pi.ean
      WHERE r.user_id = ? AND r.status = 'validada'
        AND (pi.qtd_prescrita - pi.qtd_usada) > 0
        AND pi.consumo = 'saldo'          -- antibiótico não é tratamento contínuo
        AND (r.valida_ate IS NULL OR r.valida_ate >= date('now'))
      ORDER BY r.validada_em DESC LIMIT 3`, user.id) : [];

  const recomprar = user ? todos(
    `SELECT p.*, MAX(o.entregue_em) AS ultima_compra, COUNT(*) AS vezes
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id AND o.user_id = ? AND o.status = 'entregue'
       JOIN products p ON p.ean = oi.ean
      WHERE p.controlado_344 = 0 ${filtroReceita()}
      GROUP BY p.ean ORDER BY ultima_compra DESC LIMIT 6`, user.id) : [];

  for (const lista of [ofertas, continuos, recomprar]) {
    for (const it of lista) {
      const inv = um('SELECT * FROM inventory WHERE pharmacy_id = ? AND ean = ?', loja?.id ?? '', it.ean);
      // preco_centavos = preço de tabela; preco_final_centavos = o que ESTE cliente paga
      it.preco_centavos = inv?.preco_centavos ?? null;
      it.preco_final_centavos = inv ? preco(inv) : null;
      it.preco_de_centavos = inv?.preco_de_centavos ?? null;
      it.preco_socio_centavos = inv?.preco_socio_centavos ?? null;
      it.estoque = inv?.estoque ?? 0;
    }
  }

  const agora = new Date();
  const h = agora.getHours();
  return {
    saudacao: h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite',
    user: user ? { id: user.id, nome: user.nome, socio: !!user.socio } : null,
    endereco,
    farmacia: loja ? {
      id: loja.id, nome: loja.nome_fantasia, bairro: loja.bairro,
      frete_centavos: loja.frete_centavos, frete_gratis_acima_centavos: loja.frete_gratis_acima_centavos,
    } : null,
    receita_habilitada: CONFIG.receita_habilitada,
    area: CONFIG.area,
    fora_da_area: !!endereco && !CONFIG.area.includes(endereco.bairro),
    continuos, recomprar: recomprar.filter((r) => !continuos.some((c) => c.ean === r.ean)),
    ofertas,
    categorias: todos(
      `SELECT p.categoria, COUNT(DISTINCT p.ean) AS n
         FROM products p JOIN inventory i ON i.ean = p.ean AND i.pharmacy_id = ? AND i.ativo = 1
        WHERE p.categoria IS NOT NULL AND p.controlado_344 = 0 ${filtroReceita()}
        GROUP BY p.categoria ORDER BY n DESC`, loja?.id ?? ''),
    pedido_em_andamento: user ? um(
      `SELECT id, codigo, status, criado_em, despachado_em FROM orders
        WHERE user_id = ? AND status NOT IN ('entregue','cancelado')
        ORDER BY criado_em DESC LIMIT 1`, user.id) : null,
    armario: user ? armario.resumo(user.id) : null,
    pedidos_abertos: user ? um(
      `SELECT COUNT(*) AS n FROM orders WHERE user_id = ?
        AND status NOT IN ('entregue','cancelado')`, user.id).n : 0,
    // pedido entregue e ainda sem nota: a doca lembra
    a_avaliar: user ? um(
      `SELECT o.id, o.codigo FROM orders o
        LEFT JOIN avaliacoes a ON a.order_id = o.id
        WHERE o.user_id = ? AND o.status = 'entregue' AND a.id IS NULL
        ORDER BY o.entregue_em DESC LIMIT 1`, user.id) : null,
  };
}
