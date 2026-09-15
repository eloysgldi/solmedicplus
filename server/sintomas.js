/**
 * ============================================================
 * Busca por sintoma.
 *
 * As pessoas não pensam em princípio ativo, pensam em "dor de garganta".
 * A fronteira aqui é dura e não se negocia: isto é NAVEGAÇÃO, não
 * recomendação. A gente mostra a prateleira que costuma responder àquilo
 * e diz, em cada tela, que quem orienta é o farmacêutico.
 * ============================================================
 */
export const SINTOMAS = [
  { id: 'dor_cabeca', rotulo: 'Dor de cabeça', icone: 'dor',
    categorias: ['dor'], principios: ['Dipirona', 'Paracetamol', 'Ibuprofeno'] },
  { id: 'febre', rotulo: 'Febre', icone: 'dor',
    categorias: ['dor'], principios: ['Dipirona', 'Paracetamol'] },
  { id: 'gripe', rotulo: 'Gripe e resfriado', icone: 'gripe',
    categorias: ['gripe'], principios: ['Cloreto de sódio', 'Cânfora'] },
  { id: 'garganta', rotulo: 'Dor de garganta', icone: 'gripe',
    categorias: ['gripe', 'dor'], principios: [] },
  { id: 'azia', rotulo: 'Azia e má digestão', icone: 'higiene',
    categorias: ['higiene'], principios: ['Bicarbonato'] },
  { id: 'enjoo', rotulo: 'Enjoo e tontura', icone: 'dor',
    categorias: ['dor'], principios: ['Dimenidrinato'] },
  { id: 'pele', rotulo: 'Pele ressecada', icone: 'dermo',
    categorias: ['dermo'], principios: ['Dexpantenol', 'Ureia'] },
  { id: 'sol', rotulo: 'Proteção solar', icone: 'dermo',
    categorias: ['dermo'], principios: ['Avobenzona', 'Dióxido de titânio'] },
  { id: 'corte', rotulo: 'Corte e curativo', icone: 'higiene',
    categorias: ['higiene'], principios: ['Peróxido', 'Etanol'] },
  { id: 'bebe', rotulo: 'Cuidados com bebê', icone: 'bebe',
    categorias: ['bebe'], principios: [] },
  { id: 'imunidade', rotulo: 'Imunidade e disposição', icone: 'vitaminas',
    categorias: ['vitaminas'], principios: [] },
];

export const RESSALVA_SINTOMA =
  'Isto é uma prateleira, não uma indicação. Em dúvida, fale com o farmacêutico.';

export const acha = (id) => SINTOMAS.find((s) => s.id === id) || null;
