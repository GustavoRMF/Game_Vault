const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { authMiddleware, createToken } = require('../middleware/auth');
const { generateBase32Secret, verifyTotp, buildOtpAuthUri } = require('../utils/totp');

const router = express.Router();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  if (!salt) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hash, 'hex'));
}

// Registro
router.post('/register', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ error: 'O usuário deve ter entre 3 e 30 caracteres.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'A senha deve ter no mínimo 8 dígitos.' });
    }

    const exists = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    if (exists.rowCount > 0) {
      return res.status(409).json({ error: 'Este nome de usuário já está em uso.' });
    }

    const { hash, salt } = hashPassword(password);
    const { hash: prefixHash, salt: prefixSalt } = hashPassword(password.slice(0, 3));
    const createdAt = Date.now();

    const insert = await pool.query(
      `INSERT INTO users (username, password_hash, salt, prefix_hash, prefix_salt, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, username`,
      [username, hash, salt, prefixHash, prefixSalt, createdAt]
    );

    const user = insert.rows[0];
    const token = createToken({ id: user.id, username: user.username });
    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Erro no cadastro:', err);
    res.status(500).json({ error: 'Erro interno ao cadastrar usuário.' });
  }
});

// Login (com verificação opcional de 2FA)
router.post('/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const totpCode = String(req.body.totpCode || '').trim();

    const result = await pool.query(
      'SELECT id, username, password_hash, salt, totp_secret, totp_enabled FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );
    const user = result.rows[0];

    if (!user || !verifyPassword(password, user.password_hash, user.salt)) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }

    // Se o jogador ativou 2FA e ainda não enviou o código de 6 dígitos
    if (user.totp_enabled && user.totp_secret) {
      if (!totpCode) {
        return res.json({
          requires2FA: true,
          message: 'Digite o código de 6 dígitos do seu aplicativo autenticador.'
        });
      }
      if (!verifyTotp(user.totp_secret, totpCode)) {
        return res.status(401).json({
          requires2FA: true,
          error: 'Código 2FA inválido ou expirado. Confira o aplicativo e tente novamente.'
        });
      }
    }

    const token = createToken({ id: user.id, username: user.username });
    res.json({
      token,
      user: { id: user.id, username: user.username, totpEnabled: Boolean(user.totp_enabled) }
    });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ error: 'Erro interno ao fazer login.' });
  }
});

// Redefinir senha pelos 3 primeiros dígitos
router.post('/reset-password', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const firstThree = String(req.body.firstThree || '');
    const newPassword = String(req.body.newPassword || '');

    if (firstThree.length !== 3 || newPassword.length < 8) {
      return res.status(400).json({ error: 'Dados inválidos para redefinição.' });
    }

    const result = await pool.query(
      'SELECT id, username, prefix_hash, prefix_salt FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );
    const user = result.rows[0];

    if (!user || !verifyPassword(firstThree, user.prefix_hash, user.prefix_salt)) {
      return res.status(401).json({ error: 'Usuário não encontrado ou os 3 primeiros dígitos não conferem.' });
    }

    const { hash, salt } = hashPassword(newPassword);
    const { hash: prefixHash, salt: prefixSalt } = hashPassword(newPassword.slice(0, 3));

    await pool.query(
      'UPDATE users SET password_hash = $1, salt = $2, prefix_hash = $3, prefix_salt = $4 WHERE id = $5',
      [hash, salt, prefixHash, prefixSalt, user.id]
    );

    const token = createToken({ id: user.id, username: user.username });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('Erro ao redefinir senha:', err);
    res.status(500).json({ error: 'Erro ao redefinir senha.' });
  }
});

// ===== Rotas de Configuração 2FA (Opcional) =====
router.get('/2fa/status', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT totp_enabled FROM users WHERE id = $1', [req.user.id]);
    res.json({ enabled: Boolean(result.rows[0]?.totp_enabled) });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao verificar status do 2FA.' });
  }
});

router.post('/2fa/setup', authMiddleware, async (req, res) => {
  try {
    const secret = generateBase32Secret(20);
    await pool.query('UPDATE users SET totp_secret = $1 WHERE id = $2', [secret, req.user.id]);

    const otpauthUrl = buildOtpAuthUri({
      secret,
      accountName: req.user.username,
      issuer: 'GameVault'
    });

    res.json({ secret, otpauthUrl });
  } catch (err) {
    console.error('Erro ao gerar 2FA:', err);
    res.status(500).json({ error: 'Erro ao gerar chave 2FA.' });
  }
});

router.post('/2fa/enable', authMiddleware, async (req, res) => {
  try {
    const code = String(req.body.code || '').trim();
    const result = await pool.query('SELECT totp_secret FROM users WHERE id = $1', [req.user.id]);
    const secret = result.rows[0]?.totp_secret;

    if (!secret || !verifyTotp(secret, code)) {
      return res.status(400).json({ error: 'Código inválido. Verifique os 6 dígitos no app autenticador.' });
    }

    await pool.query('UPDATE users SET totp_enabled = TRUE WHERE id = $1', [req.user.id]);
    res.json({ enabled: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao ativar 2FA.' });
  }
});

router.post('/2fa/disable', authMiddleware, async (req, res) => {
  try {
    const code = String(req.body.code || '').trim();
    const result = await pool.query('SELECT totp_secret FROM users WHERE id = $1', [req.user.id]);
    const secret = result.rows[0]?.totp_secret;

    if (!secret || !verifyTotp(secret, code)) {
      return res.status(400).json({ error: 'Código inválido para desativar o 2FA.' });
    }

    await pool.query('UPDATE users SET totp_enabled = FALSE, totp_secret = \'\' WHERE id = $1', [req.user.id]);
    res.json({ enabled: false });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao desativar 2FA.' });
  }
});

module.exports = router;