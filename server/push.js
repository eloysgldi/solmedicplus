import crypto from 'node:crypto';
import { um, roda, agora } from './db.js';

/**
 * ============================================================
 * Web Push sem biblioteca.
 *
 * São dois protocolos empilhados:
 *   VAPID (RFC 8292) — um JWT ES256 que prova ao serviço de push
 *     (FCM, Mozilla) que somos nós mandando.
 *   aes128gcm (RFC 8291) — o payload é cifrado com uma chave derivada
 *     do par ECDH entre nós e o navegador. Nem o Google lê o conteúdo.
 *
 * É por isso que dá para mandar o nome do remédio sem entregá-lo ao
 * intermediário — a farmácia e o cliente são as duas únicas pontas.
 * ============================================================
 */

const b64url = (b) => Buffer.from(b).toString('base64url');
const debase64 = (s) => Buffer.from(s, 'base64url');

/** O par VAPID nasce uma vez e fica no banco: trocar invalida as inscrições. */
/** A chave privada vem do ambiente numa linha só; aqui ela volta a ter quebras. */
const pem = (txt) => String(txt).split('\\n').join('\n');

export function chavesVapid() {
  // em hospedagem de disco efêmero o banco volta do zero a cada deploy, e
  // com ele as chaves — o que invalidaria a inscrição de todo aparelho já
  // registrado. Por isso o ambiente manda mais que o banco.
  if (process.env.SM_VAPID_PUB && process.env.SM_VAPID_PRIV_PEM) {
    return {
      publica: process.env.SM_VAPID_PUB,
      privada_pem: pem(process.env.SM_VAPID_PRIV_PEM),
      assunto: process.env.SM_PUSH_EMAIL || 'mailto:contato@solmedic.com.br',
    };
  }
  const guardado = um("SELECT valor FROM configuracoes WHERE chave = 'vapid'");
  if (!guardado && process.env.NODE_ENV === 'production') {
    console.warn('\n  [push] gerando par VAPID novo.\n'
      + '  Em disco efemero isso acontece a cada deploy e derruba todas as\n'
      + '  inscricoes existentes. Rode "npm run vapid" e fixe SM_VAPID_PUB e\n'
      + '  SM_VAPID_PRIV_PEM no painel da hospedagem.\n');
  }
  if (guardado) return JSON.parse(guardado.valor);

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const par = {
    publica: b64url(Buffer.concat([Buffer.from([4]), debase64(jwk.x), debase64(jwk.y)])),
    privada_pem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    assunto: process.env.SM_PUSH_EMAIL || 'mailto:contato@solmedic.com.br',
  };
  roda(`INSERT INTO configuracoes (chave,valor,alterado_em) VALUES ('vapid',?,?)`,
    JSON.stringify(par), agora());
  return par;
}

/** JWT ES256 assinado com a chave VAPID. Vale 12h, como manda a norma. */
function jwtVapid(endpoint) {
  const { privada_pem, assunto } = chavesVapid();
  const aud = new URL(endpoint).origin;
  const cabecalho = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const corpo = b64url(JSON.stringify({
    aud, sub: assunto, exp: Math.floor(Date.now() / 1000) + 12 * 3600,
  }));
  const entrada = `${cabecalho}.${corpo}`;
  // ieee-p1363 devolve r||s cru, que é o formato que o JWT espera
  const assinatura = crypto.sign('sha256', Buffer.from(entrada),
    { key: crypto.createPrivateKey(privada_pem), dsaEncoding: 'ieee-p1363' });
  return `${entrada}.${b64url(assinatura)}`;
}

const hmac = (chave, dado) => crypto.createHmac('sha256', chave).update(dado).digest();
const hkdf = (sal, ikm, info, tam) =>
  hmac(hmac(sal, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, tam);

/** Cifra o payload para ESTE navegador. Ninguém no caminho lê. */
function cifra(texto, p256dh, auth) {
  const clientePub = debase64(p256dh);
  const segredoAuth = debase64(auth);

  const efemera = crypto.createECDH('prime256v1');
  efemera.generateKeys();
  const nossaPub = efemera.getPublicKey();
  const compartilhado = efemera.computeSecret(clientePub);

  const sal = crypto.randomBytes(16);
  const infoChave = Buffer.concat([
    Buffer.from('WebPush: info\0'), clientePub, nossaPub,
  ]);
  const ikm = hkdf(segredoAuth, compartilhado, infoChave, 32);
  const cek = hkdf(sal, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(sal, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cifrador = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const dados = Buffer.concat([
    cifrador.update(Buffer.concat([Buffer.from(texto, 'utf8'), Buffer.from([2])])),
    cifrador.final(), cifrador.getAuthTag(),
  ]);

  const cabecalho = Buffer.alloc(21);
  sal.copy(cabecalho, 0);
  cabecalho.writeUInt32BE(4096, 16);   // tamanho do registro
  cabecalho.writeUInt8(65, 20);        // tamanho da chave que vai a seguir
  return Buffer.concat([cabecalho, nossaPub, dados]);
}

/**
 * Entrega de fato. Devolve o status para quem chamou decidir se apaga
 * a inscrição — 404 e 410 significam que o navegador sumiu.
 */
export async function envia(inscricao, payload) {
  const corpo = cifra(JSON.stringify(payload), inscricao.p256dh, inscricao.auth);
  const { publica } = chavesVapid();
  const res = await fetch(inscricao.endpoint, {
    method: 'POST',
    headers: {
      TTL: '600',
      Urgency: payload.insistente ? 'high' : 'normal',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(corpo.length),
      Authorization: `vapid t=${jwtVapid(inscricao.endpoint)}, k=${publica}`,
    },
    body: corpo,
  });
  return { status: res.status, morta: res.status === 404 || res.status === 410 };
}
