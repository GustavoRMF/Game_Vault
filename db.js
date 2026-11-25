const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(40) UNIQUE NOT NULL,
      display_name VARCHAR(40) DEFAULT '',
      password_hash TEXT NOT NULL,
      salt TEXT,
      prefix_hash TEXT,
      prefix_salt TEXT,
      avatar TEXT DEFAULT '',
      birthday VARCHAR(20) DEFAULT '',
      consoles TEXT DEFAULT '[]',
      last_seen BIGINT DEFAULT 0,
      created_at BIGINT NOT NULL
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(40) DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS salt TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS prefix_hash TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS prefix_salt TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday VARCHAR(20) DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS consoles TEXT DEFAULT '[]';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen BIGINT DEFAULT 0;

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS wishlist (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      platform TEXT NOT NULL,
      genre TEXT DEFAULT '',
      priority TEXT DEFAULT 'Média',
      target_price NUMERIC(10,2),
      cover TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      added_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS community_posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT DEFAULT 'Geral',
      color TEXT DEFAULT 'blue',
      created_at BIGINT NOT NULL
    );

    ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS color TEXT DEFAULT 'blue';

    CREATE TABLE IF NOT EXISTS post_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS post_reactions (
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      PRIMARY KEY (post_id, user_id, emoji)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_games_user_id ON games(user_id);
    CREATE INDEX IF NOT EXISTS idx_wishlist_user_id ON wishlist(user_id);
    CREATE INDEX IF NOT EXISTS idx_posts_created_at ON community_posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comments_post_id ON post_comments(post_id);
    CREATE INDEX IF NOT EXISTS idx_chat_created_at ON chat_messages(created_at DESC);
  `);

  console.log('Banco de dados Neon conectado e tabelas verificadas.');
}

module.exports = { pool, initDb };