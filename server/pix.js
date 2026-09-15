import { um, roda, id, agora } from './db.js';
import { Erro } from './http.js';
import * as psp from './psp.js';
import { CONFIG } from './config.js';

/**
 * ============================================================
 * PIX — o BR Code, montado à mão.
 *
 * O "copia e cola" do PIX é um EMV BR Code: campos em TLV
 * (id de 2 dígitos, tamanho de 2, valor) e um CRC16-CCITT no fim.
 * Está tudo aqui porque é simples e porque vale entender: o dia que
 * trocar de provedor, só a chave muda.
 *
 * A regra que não muda: no cartão a gente AUTORIZA e captura depois.
 * No PIX o dinheiro entra na hora — então o QR de um pedido com receita
 * só é gerado DEPOIS que o farmacêutico libera. Cobrar antes e estornar
 * depois é péssimo para quem está esperando remédio.
 * ============================================================
 */

const tlv = (idCampo, valor) =>
  `${idCampo}${String(valor.length).padStart(2, '0')}${valor}`;

function crc16(texto) {
  let crc = 0xFFFF;
  for (const byte of Buffer.from(texto, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const semAcento = (s) => String(s ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '').trim();

/** Monta o copia e cola. `txid` liga o pagamento ao pedido na conciliação. */
export function brCode({ chave, nome, cidade, valorCentavos, txid }) {
  const conta = tlv('00', 'br.gov.bcb.pix') + tlv('01', chave);
  const partes = [
    tlv('00', '01'),                                  // formato
    tlv('26', conta),                                 // conta do recebedor
    tlv('52', '0000'),                                // categoria
    tlv('53', '986'),                                 // moeda: real
    tlv('54', (valorCentavos / 100).toFixed(2)),      // valor
    tlv('58', 'BR'),                                  // país
    tlv('59', semAcento(nome).slice(0, 25)),
    tlv('60', semAcento(cidade).slice(0, 15)),
    tlv('62', tlv('05', semAcento(txid).slice(0, 25))),
  ].join('');
  const semCrc = partes + '6304';
  return semCrc + crc16(semCrc);
}

/** Gera a cobrança PIX de um pedido. Só depois que ele pode ser cobrado. */
export async function cobra(orderId) {
  const o = um('SELECT * FROM orders WHERE id = ?', orderId);
  if (!o) throw new Erro(404, 'PEDIDO_INEXISTENTE', 'Pedido não encontrado');
  if (o.tem_receita && ['criado', 'aguardando_loja', 'aguardando_receita'].includes(o.status)) {
    throw new Erro(409, 'AGUARDA_FARMACEUTICO',
      'Pedido com receita só gera o PIX depois que o farmacêutico libera — '
      + 'não dá para receber e ter que devolver se ele recusar.');
  }

  const ja = um(`SELECT * FROM payments WHERE order_id = ? AND metodo = 'pix'
                   AND status IN ('autorizado','capturado')`, orderId);
  if (ja?.status === 'capturado') return { pagamento: ja, ja_pago: true };

  const loja = um('SELECT * FROM pharmacies WHERE id = ?', o.pharmacy_id);
  const chave = CONFIG.pix_chave || loja?.cnpj || '00000000000000';
  const codigo = brCode({
    chave, nome: loja?.nome_fantasia ?? 'Solmedic', cidade: loja?.cidade ?? 'FORTALEZA',
    valorCentavos: o.total_centavos, txid: o.codigo.replace(/-/g, ''),
  });

  const pid = ja?.id ?? id();
  if (!ja) {
    roda(`INSERT INTO payments (id,order_id,provedor,metodo,status,
            valor_autorizado_centavos,external_id,autorizado_em)
          VALUES (?,?,?,?,?,?,?,?)`,
      pid, orderId, 'pix-mock', 'pix', 'autorizado', o.total_centavos,
      'pix_' + pid.slice(0, 8), agora());
  }
  // com o provedor ligado, quem manda é ele: o código dele é rastreável
  // e o webhook confirma sozinho. Sem provedor, vale o BR Code da casa.
  let doPsp = null;
  if (psp.ligado()) {
    try {
      doPsp = await psp.cobranca({
        txid: o.codigo.replace(/-/g, ''), valorCentavos: o.total_centavos, chave,
        descricao: `${loja?.nome_fantasia ?? 'Solmedic+'} · pedido ${o.codigo}`,
      });
      roda(`UPDATE payments SET provedor='versell', external_id=? WHERE id=?`, doPsp.txid, pid);
    } catch (e) {
      // provedor fora do ar não pode impedir a venda: cai no código da casa
      console.error('[psp]', e.message);
    }
  }

  return {
    pagamento: um('SELECT * FROM payments WHERE id = ?', pid),
    copia_e_cola: doPsp?.copia_e_cola ?? codigo,
    provedor: doPsp ? 'versell' : 'local',
    txid: doPsp?.txid ?? null,
    // o app mostra este número embaixo do QR: é o total do pedido, com frete
    valor_centavos: o.total_centavos,
    expira_em: new Date(Date.now() + 30 * 60000).toISOString(),
    chave_usada: chave,
  };
}

/** No mundo real quem chama isto é o webhook do provedor. */
export function confirma(orderId, { external_id } = {}) {
  const p = um(`SELECT * FROM payments WHERE order_id = ? AND metodo='pix'
                  AND status='autorizado'`, orderId);
  if (!p) throw new Erro(404, 'SEM_COBRANCA', 'Não há cobrança PIX aberta para este pedido');
  roda(`UPDATE payments SET status='capturado', valor_capturado_centavos=?, capturado_em=?,
          external_id=COALESCE(?, external_id) WHERE id=?`,
    p.valor_autorizado_centavos, agora(), external_id ?? null, p.id);
  return um('SELECT * FROM payments WHERE id = ?', p.id);
}
