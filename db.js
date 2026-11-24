const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
const isLocal = connectionString && (connectionString.includes('localhost') || connectionString.includes('127.0.0.1'));

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(40) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      prefix_hash TEXT,
      prefix_salt TEXT,
      created_at BIGINT NOT NULL,
      last_seen BIGINT DEFAULT 0
    );
  `);

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS salt TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS prefix_hash TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS prefix_salt TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at BIGINT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen BIGINT DEFAULT 0;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      platform TEXT NOT NULL,
      genre TEXT DEFAULT '',
      status TEXT NOT NULL,
      rating NUMERIC(3,1),
      hours NUMERIC(8,1) DEFAULT 0,
      cover TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      added_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wishlist (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      platform TEXT NOT NULL,
      genre TEXT DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'Média',
      target_price NUMERIC(10,2),
      cover TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      added_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category VARCHAR(40) DEFAULT 'Geral',
      color VARCHAR(20) DEFAULT 'blue',
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT 'blue';`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_reactions (
      post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      emoji VARCHAR(16) NOT NULL,
      PRIMARY KEY (post_id, user_id, emoji)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
  `);

  console.log('Banco de dados Neon conectado e tabelas verificadas.');
}

module.exports = { pool, initDb };