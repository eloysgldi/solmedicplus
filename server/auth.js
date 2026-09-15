import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { um, todos, roda, id, agora, maisSegundos } from './db.js';
import { Erro } from './http.js';

export function hashSenha(senha) {
  const sal = randomBytes(16).toString('hex');
  return sal + ':' + scryptSync(senha, sal, 32).toString('hex');
}

export function confereSenha(senha, guardado) {
  const [sal, hash] = String(guardado).split(':');
  if (!sal || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(senha, sal, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function criaSessao(userId, horas = 24 * 30) {
  const token = randomBytes(24).toString('base64url');
  roda('INSERT INTO sessions (token, user_id, criado_em, expira_em) VALUES (?,?,?,?)',
    token, userId, agora(), maisSegundos(horas * 3600));
  return token;
}

/**
 * Resolve quem está falando. Devolve o usuário + os papéis que ele tem
 * em cada farmácia. Um mesmo CPF pode ser cliente num lugar e
 * farmacêutico responsável no outro.
 */
export function quemE(req) {
  const cabecalho = req.headers.authorization || '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null;
  if (!token) return null;
  const s = um('SELECT * FROM sessions WHERE token = ?', token);
  if (!s || s.expira_em < agora()) return null;
  const u = um('SELECT id, nome, email, papel_global, socio FROM users WHERE id = ?', s.user_id);
  if (!u) return null;
  u.lojas = todos(
    `SELECT pu.pharmacy_id, pu.papel, pu.crf, pu.crf_uf, pu.responsavel_tecnico, p.nome_fantasia
       FROM pharmacy_users pu JOIN pharmacies p ON p.id = pu.pharmacy_id
      WHERE pu.user_id = ? AND pu.ativo = 1`, u.id);
  u.entregador = um('SELECT * FROM couriers WHERE user_id = ? AND ativo = 1', u.id);
  return u;
}

export function exigeLogin(req) {
  const u = quemE(req);
  if (!u) throw new Erro(401, 'NAO_AUTENTICADO', 'Faça login para continuar');
  return u;
}

export function exigeAdmin(req) {
  const u = exigeLogin(req);
  if (u.papel_global !== 'admin') throw new Erro(403, 'SEM_PERMISSAO', 'Só o admin da plataforma faz isso');
  return u;
}

/** Papel dentro de uma loja específica. */
export function papelNaLoja(u, pharmacyId) {
  return u.lojas?.find((l) => l.pharmacy_id === pharmacyId) || null;
}

export function exigeLoja(req, pharmacyId, papeis = ['gerente', 'operador', 'farmaceutico']) {
  const u = exigeLogin(req);
  if (u.papel_global === 'admin') return { u, vinculo: { papel: 'gerente', crf: null } };
  const v = papelNaLoja(u, pharmacyId);
  if (!v || !papeis.includes(v.papel)) {
    throw new Erro(403, 'SEM_PERMISSAO', 'Você não opera essa farmácia');
  }
  return { u, vinculo: v };
}

/** O farmacêutico precisa de CRF ativo — sem isso não libera receita. */
export function exigeFarmaceutico(req, pharmacyId) {
  const { u, vinculo } = exigeLoja(req, pharmacyId, ['farmaceutico']);
  if (!vinculo.crf) throw new Erro(403, 'SEM_CRF', 'Só farmacêutico com CRF ativo libera receita');
  return { u, vinculo };
}

export function registraAcesso(userId, recurso, recursoId, acao, ip) {
  roda('INSERT INTO access_log (id,user_id,recurso,recurso_id,acao,ip,criado_em) VALUES (?,?,?,?,?,?,?)',
    id(), userId, recurso, recursoId, acao, ip ?? null, agora());
}
