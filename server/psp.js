import { readFileSync } from 'node:fs';
import https from 'node:https';
import { um, roda, agora } from './db.js';
import { Erro } from './http.js';

/**
 * ============================================================
 * O provedor de pagamento (PSP)
 *
 * Os certificados da Versell/ONZ são mTLS: não existe "chave de API",
 * existe um certificado cliente que prova quem está chamando. É o
 * desenho da API Pix do Banco Central, que todo PSP implementa igual:
 *
 *   PUT  /v2/cob/{txid}   cria a cobrança com o valor exato
 *   GET  /v2/cob/{txid}   consulta se já foi paga
 *   POST /oauth/token     troca o certificado por um token de acesso
 *
 * Enquanto SM_PSP_BASE não estiver configurado, o sistema usa o BR Code
 * estático que ele mesmo monta — que é válido e cai na conta certa, mas
 * não avisa sozinho quando o dinheiro entra. Com o PSP ligado, o webhook
 * confirma e o pedido anda sem ninguém apertar nada.
 * ============================================================
 */

export const ligado = () => !!process.env.SM_PSP_BASE;

/** O certificado vem de arquivo (.pfx ou .crt/.key) ou de base64 no ambiente. */
let agente = null;
function tls() {
  if (agente) return agente;
  const b64 = (v) => (v ? Buffer.from(v, 'base64') : null);
  const arq = (v) => (v ? readFileSync(v) : null);
  const opcoes = { keepAlive: true };

  const pfx = b64(process.env.SM_PSP_PFX_B64) ?? arq(process.env.SM_PSP_PFX);
  if (pfx) {
    opcoes.pfx = pfx;
    opcoes.passphrase = process.env.SM_PSP_PFX_SENHA ?? '';
  } else {
    opcoes.cert = b64(process.env.SM_PSP_CERT_B64) ?? arq(process.env.SM_PSP_CERT);
    opcoes.key = b64(process.env.SM_PSP_KEY_B64) ?? arq(process.env.SM_PSP_KEY);
  }
  if (!opcoes.pfx && !opcoes.cert) {
    throw new Erro(500, 'PSP_SEM_CERTIFICADO',
      'SM_PSP_BASE está ligado mas nenhum certificado foi informado');
  }
  agente = new https.Agent(opcoes);
  return agente;
}

async function chama(caminho, { metodo = 'GET', corpo, token, basica } = {}) {
  const res = await fetch(new URL(caminho, process.env.SM_PSP_BASE), {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(basica ? { Authorization: basica } : token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    dispatcher: undefined,
    agent: tls(),
  });
  const texto = await res.text();
  const dados = texto ? JSON.parse(texto) : {};
  if (!res.ok) {
    throw new Erro(502, 'PSP_RECUSOU',
      dados.detail || dados.mensagem || `O provedor respondeu ${res.status}`);
  }
  return dados;
}

/** O token do OAuth vale alguns minutos; guardar evita uma ida a cada cobrança. */
let cache = { token: null, ate: 0 };
async function acesso() {
  if (cache.token && Date.now() < cache.ate) return cache.token;
  // client_id e client_secret vão em Basic, como manda o OAuth2 —
  // o certificado mTLS continua provando de qual máquina veio a chamada
  const id_ = process.env.SM_PSP_CLIENT_ID, seg = process.env.SM_PSP_CLIENT_SECRET;
  const basica = id_ && seg
    ? 'Basic ' + Buffer.from(`${id_}:${seg}`).toString('base64') : null;
  const r = await chama(process.env.SM_PSP_TOKEN_PATH || '/oauth/token', {
    metodo: 'POST', basica,
    corpo: { grant_type: 'client_credentials',
      scope: process.env.SM_PSP_SCOPE || 'cob.write cob.read pix.read' },
  });
  cache = {
    token: r.access_token,
    ate: Date.now() + ((r.expires_in ?? 600) - 30) * 1000,
  };
  return cache.token;
}

/**
 * Cria a cobrança com o valor exato do pedido.
 *
 * O txid é o código do pedido sem hífen — assim o extrato da conta bate
 * com a tela do painel sem ninguém ter que cruzar planilha.
 */
export async function cobranca({ txid, valorCentavos, chave, descricao, nomePagador, cpf }) {
  const token = await acesso();
  const r = await chama(`/v2/cob/${txid}`, {
    metodo: 'PUT', token,
    corpo: {
      calendario: { expiracao: Number(process.env.SM_PSP_EXPIRA || 1800) },
      valor: { original: (valorCentavos / 100).toFixed(2) },
      chave,
      solicitacaoPagador: descricao?.slice(0, 140),
      ...(cpf ? { devedor: { cpf, nome: nomePagador } } : {}),
    },
  });
  return {
    txid: r.txid ?? txid,
    copia_e_cola: r.pixCopiaECola ?? r.pix_copia_e_cola ?? null,
    location: r.location ?? null,
    expira_em: new Date(Date.now()
      + (r.calendario?.expiracao ?? 1800) * 1000).toISOString(),
  };
}

/** Consulta de segurança: o "já paguei" do cliente pergunta ao banco, não confia. */
export async function consulta(txid) {
  const r = await chama(`/v2/cob/${txid}`, { token: await acesso() });
  const pago = r.status === 'CONCLUIDA';
  return {
    pago,
    status: r.status,
    valor_centavos: r.valor?.original ? Math.round(Number(r.valor.original) * 100) : null,
    e2e: r.pix?.[0]?.endToEndId ?? null,
  };
}

/**
 * O webhook do provedor.
 *
 * Nunca acredita no valor que vem no corpo: confere com o pedido. Um
 * webhook é um endereço público, e quem descobre o endereço pode mandar
 * qualquer coisa para lá.
 */
export function confereWebhook(req) {
  const segredo = process.env.SM_PSP_WEBHOOK_SEGREDO;
  if (!segredo) return true;
  const veio = req.headers['x-webhook-segredo'] ?? req.headers['x-hub-signature'];
  if (veio !== segredo) {
    throw new Erro(401, 'WEBHOOK_NAO_AUTENTICADO', 'Assinatura do webhook não confere');
  }
  return true;
}

/** Guarda o que o provedor devolveu, para o suporte ter o que olhar depois. */
export function registra(orderId, dados) {
  const p = um(`SELECT * FROM payments WHERE order_id = ? AND metodo = 'pix'`, orderId);
  if (p) {
    roda(`UPDATE payments SET provedor='versell', external_id=COALESCE(?, external_id) WHERE id=?`,
      dados.txid ?? null, p.id);
  }
  return p;
}
