const crypto = require('crypto');
const { pool } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || crypto
  .createHash('sha256')
  .update(process.env.DATABASE_URL || 'gamevault-secret')
  .digest('hex');

function hashSecret(value, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(value, salt, 64).toString('hex');
  return { salt, hash };
}

function verifySecret(value, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  try {
    const { hash } = hashSecret(value, salt);
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(expectedHash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function createToken(user) {
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    username: user.username,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.exp && data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

const lastPingCache = new Map();

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
  req.user = user;

  // Atualiza last_seen no máximo a cada 20s para não sobrecarregar o banco
  const now = Date.now();
  const uid = String(user.id);
  if (now - (lastPingCache.get(uid) || 0) > 20000) {
    lastPingCache.set(uid, now);
    pool.query('UPDATE users SET last_seen = $1 WHERE id::text = $2', [now, uid]).catch(() => {});
  }

  next();
}

function genId() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

module.exports = { hashSecret, verifySecret, createToken, authMiddleware, genId };