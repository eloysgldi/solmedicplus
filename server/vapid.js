/**
 * Gera um par de chaves VAPID para colar no painel da hospedagem.
 *
 *   node server/vapid.js
 *
 * Sem isso o servidor gera as chaves sozinho e guarda no banco — o que
 * funciona bem localmente e mal em disco efêmero, onde cada deploy
 * inventaria chaves novas e derrubaria todas as inscrições de push.
 */
import crypto from 'node:crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = publicKey.export({ format: 'jwk' });
const publica = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(jwk.x, 'base64url'),
  Buffer.from(jwk.y, 'base64url'),
]).toString('base64url');

const privada = privateKey.export({ type: 'pkcs8', format: 'pem' }).trim()
  .split(String.fromCharCode(10)).join('\n');

console.log('');
console.log('  SM_VAPID_PUB');
console.log('  ' + publica);
console.log('');
console.log('  SM_VAPID_PRIV_PEM');
console.log('  ' + privada);
console.log('');
