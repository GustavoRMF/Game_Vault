const express = require('express');
const crypto = require('crypto');
const { pool } = require('../db');
const { hashSecret, verifySecret, createToken } = require('../middleware/auth');

const router = express.Router();

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

    const { salt, hash } = hashSecret(password);
    const { salt: prefixSalt, hash: prefixHash } = hashSecret(password.slice(0, 3));

    const result = await pool.query(
      `INSERT INTO users (username, password_hash, salt, prefix_hash, prefix_salt, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username`,
      [username, hash, salt, prefixHash, prefixSalt, Date.now()]
    );

    const user = result.rows[0];
    const token = createToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Este nome de usuário já está em uso.' });
    }
    console.error('Erro no cadastro:', err);
    res.status(500).json({ error: 'Erro interno ao cadastrar usuário.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    const result = await pool.query(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }

    const storedHash = user.password_hash || user.password || '';
    let isValid = false;
    let needsUpgrade = false;

    if (user.salt && storedHash) {
      isValid = verifySecret(password, user.salt, storedHash);
    } else if (storedHash.includes(':')) {
      const [legacySalt, legacyHash] = storedHash.split(':');
      isValid = verifySecret(password, legacySalt, legacyHash);
      needsUpgrade = isValid;
    } else if (storedHash) {
      const sha256 = crypto.createHash('sha256').update(password).digest('hex');
      isValid = storedHash === sha256 || storedHash === password;
      needsUpgrade = isValid;
    }

    if (!isValid) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }

    if (needsUpgrade || (!user.prefix_hash && password.length >= 3)) {
      const { salt, hash } = hashSecret(password);
      const { salt: prefixSalt, hash: prefixHash } = hashSecret(password.slice(0, 3));
      await pool.query(
        'UPDATE users SET password_hash = $1, salt = $2, prefix_hash = $3, prefix_salt = $4 WHERE id = $5',
        [hash, salt, prefixHash, prefixSalt, user.id]
      );
    }

    const token = createToken({ id: user.id, username: user.username });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ error: 'Erro interno ao fazer login.' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const firstThree = String(req.body.firstThree || '');
    const newPassword = String(req.body.newPassword || '');

    if (!username || firstThree.length !== 3) {
      return res.status(400).json({ error: 'Informe o usuário e os 3 primeiros dígitos da senha cadastrada.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'A nova senha deve ter no mínimo 8 dígitos.' });
    }

    const result = await pool.query(
      'SELECT id, username, prefix_hash, prefix_salt FROM users WHERE LOWER(username) = LOWER($1)',
      [username]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    if (!user.prefix_hash || !user.prefix_salt) {
      return res.status(400).json({ error: 'Esta conta ainda não possui verificação de dígitos ativada.' });
    }
    if (!verifySecret(firstThree, user.prefix_salt, user.prefix_hash)) {
      return res.status(401).json({ error: 'Os 3 primeiros dígitos não conferem com a senha cadastrada.' });
    }

    const { salt, hash } = hashSecret(newPassword);
    const { salt: newPrefixSalt, hash: newPrefixHash } = hashSecret(newPassword.slice(0, 3));

    await pool.query(
      'UPDATE users SET password_hash = $1, salt = $2, prefix_hash = $3, prefix_salt = $4 WHERE id = $5',
      [hash, salt, newPrefixHash, newPrefixSalt, user.id]
    );

    const token = createToken({ id: user.id, username: user.username });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('Erro ao redefinir senha:', err);
    res.status(500).json({ error: 'Erro interno ao redefinir senha.' });
  }
});

module.exports = router;