import { um, roda, agora } from './db.js';

/**
 * ============================================================
 * O que está ligado nesta operação.
 *
 * A máquina de receita continua inteira no código e nos testes — ela só
 * está desligada. Apagar seria jogar fora meses de conformidade para
 * reescrever tudo quando o alvará permitir; um interruptor custa nada.
 * ============================================================
 */
const PADRAO = {
  /** false = catálogo só com venda livre. Liga quando a licença permitir aviar receita. */
  receita_habilitada: process.env.SM_RECEITA === '1',
  /** Somos a farmácia, não um marketplace: uma loja, a nossa. */
  loja_propria: true,
  /**
   * Bairros atendidos hoje. Fora daqui o app avisa em vez de fingir.
   * Isto é ponto de partida: quem manda é a tela de Configurações da loja.
   */
  area: ['Centro', 'Jardim Primavera', 'Vila Nova', 'Bela Vista', 'Alto da Serra'],
  /** Chave PIX da farmácia. Vazio usa o CNPJ. */
  pix_chave: process.env.SM_PIX || '',
  /** Cartão continua ligado; PIX é a opção mais barata para a casa. */
  pix_habilitado: true,
};

function guardado(chave) {
  const r = um('SELECT valor FROM configuracoes WHERE chave = ?', chave);
  return r ? JSON.parse(r.valor) : undefined;
}

/** Lida a cada uso: o interruptor vale na hora, sem reiniciar nada. */
export const CONFIG = new Proxy({}, {
  get(_, chave) {
    const g = guardado(String(chave));
    return g === undefined ? PADRAO[chave] : g;
  },
  ownKeys: () => Reflect.ownKeys(PADRAO),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});

export function defineConfig(chave, valor, userId) {
  if (!(chave in PADRAO)) throw new Error(`Chave desconhecida: ${chave}`);
  roda(`INSERT INTO configuracoes (chave,valor,alterado_por,alterado_em) VALUES (?,?,?,?)
        ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor,
          alterado_por=excluded.alterado_por, alterado_em=excluded.alterado_em`,
    chave, JSON.stringify(valor), userId ?? null, agora());
  return { [chave]: valor };
}

export const todasConfigs = () =>
  Object.fromEntries(Object.keys(PADRAO).map((k) => [k, CONFIG[k]]));

/** A farmácia da casa. Com loja própria, não existe "escolher farmácia". */
export function lojaDaCasa() {
  return um(`SELECT * FROM pharmacies WHERE status = 'ativa' ORDER BY criado_em LIMIT 1`);
}

/** Filtro SQL que some do catálogo tudo que exige receita, quando desligado. */
export const filtroReceita = () =>
  CONFIG.receita_habilitada ? '' : ' AND p.requer_receita = 0 AND p.controlado_344 = 0 ';

export const semReceita = (p) =>
  CONFIG.receita_habilitada || (!p.requer_receita && !p.controlado_344);
