/**
 * ============================================================
 * As regras de receita, num lugar só.
 *
 * Referências que governam cada decisão daqui:
 *   RDC 44/2009  — Boas Práticas; dispensação a distância e delivery.
 *                  Art. 52, §2º (redação da RDC 812/2023): é vedada a
 *                  COMERCIALIZAÇÃO remota de medicamentos sujeitos a
 *                  controle especial. A ENTREGA de uma venda presencial
 *                  é permitida — o que não cabe num marketplace.
 *   RDC 471/2021 — antimicrobianos: receita vale 10 dias, retém-se a
 *                  2ª via e devolve-se a 1ª carimbada. Não veda venda remota.
 *   Portaria SVS/MS 344/98 — controle especial (Notificação de Receita).
 *   RDC 873/2024 + RDC 1.000/2025 — SNCR: receituário eletrônico de
 *                  controlados só por plataforma integrada; a farmácia
 *                  valida, dá baixa e a numeração não se reusa.
 *
 * Nada de regra sanitária deve viver espalhado nas rotas. Muda a norma,
 * muda este arquivo.
 * ============================================================
 */

export const CLASSES = {
  livre: {
    rotulo: 'Venda livre',
    exige_receita: false, exige_retencao: false, venda_remota: true,
    consumo: 'saldo', dias_validade: null,
  },
  branca_simples: {
    rotulo: 'Receita simples — tarja vermelha',
    exige_receita: true, exige_retencao: false, venda_remota: true,
    consumo: 'saldo', dias_validade: 180,
  },
  branca_retida: {
    rotulo: 'Receita de controle especial em 2 vias — retenção obrigatória',
    exige_receita: true, exige_retencao: true, venda_remota: true,
    consumo: 'integral', dias_validade: 10,
  },
  notificacao: {
    rotulo: 'Notificação de Receita — Portaria 344/98',
    exige_receita: true, exige_retencao: true, venda_remota: false,
    consumo: 'integral', dias_validade: 30,
  },
};

/** Em que classe este produto cai. É daqui que sai todo o resto. */
export function classificaProduto(p) {
  if (p.controlado_344 || p.tarja === 'preta') return 'notificacao';
  if (p.retem_receita || p.glp1) return 'branca_retida';
  if (p.requer_receita || p.tarja === 'vermelha') return 'branca_simples';
  return 'livre';
}

export function regrasDoProduto(p) {
  const classe = classificaProduto(p);
  const r = CLASSES[classe];
  return {
    classe, ...r,
    dias_validade: p.dias_validade_receita ?? r.dias_validade,
    motivo_bloqueio: r.venda_remota ? null
      : 'Medicamento sob controle especial da Portaria 344/98: a venda por meio '
      + 'remoto é vedada pelo art. 52, §2º da RDC 44/2009. A retirada tem que ser '
      + 'presencial, na farmácia.',
  };
}

/**
 * Uma foto de receita de papel NÃO é prescrição eletrônica.
 * Para antimicrobiano e controlado, a diferença é o que separa
 * dispensação válida de infração.
 */
export function aceitaOrigem({ classe, origem, tipo_assinatura }) {
  if (origem === 'eletronica') {
    if (classe === 'notificacao' && tipo_assinatura !== 'qualificada') {
      return { ok: false, motivo: 'Notificação de Receita eletrônica exige assinatura qualificada (ICP-Brasil)' };
    }
    if (classe === 'branca_retida' && !['qualificada', 'avancada'].includes(tipo_assinatura)) {
      return { ok: false, motivo: 'Receita sujeita a retenção exige assinatura digital qualificada ou avançada' };
    }
    return { ok: true };
  }
  // papel: aceito, mas a via física vai precisar chegar na farmácia
  return { ok: true, exige_coleta: CLASSES[classe].exige_retencao };
}

/** Data de validade a partir da emissão, pela classe. */
export function validadeAte(classe, emitidaEm, usoContinuo = false) {
  const dias = CLASSES[classe]?.dias_validade;
  if (!dias || (usoContinuo && classe === 'branca_simples')) return null;
  const base = emitidaEm ? new Date(emitidaEm + 'T12:00:00Z') : new Date();
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

/** O que este carrinho exige, olhando todos os itens juntos. */
export function regrasDoCarrinho(produtos) {
  const classes = produtos.map(classificaProduto);
  const bloqueado = produtos.filter((p) => !CLASSES[classificaProduto(p)].venda_remota);
  return {
    classes,
    bloqueado,
    exige_receita: classes.some((c) => CLASSES[c].exige_receita),
    exige_retencao: classes.some((c) => CLASSES[c].exige_retencao),
    exige_entrega_em_maos: classes.some((c) => CLASSES[c].exige_receita),
  };
}

export const rotuloClasse = (c) => CLASSES[c]?.rotulo ?? c;
