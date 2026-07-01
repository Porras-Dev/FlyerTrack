const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || './flyertrack.db';
const db = new Database(path.resolve(dbPath));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const initDB = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      usuario TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT,
      rol TEXT NOT NULL CHECK(rol IN ('admin','jefe','rrpp')),
      foto_perfil TEXT DEFAULT NULL,
      activo INTEGER DEFAULT 1,
      creado_en TEXT DEFAULT (datetime('now')),
      ultimo_acceso TEXT DEFAULT NULL,
      intentos_login INTEGER DEFAULT 0,
      suspension_hasta TEXT DEFAULT NULL,
      bloqueado_permanente INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS grupos (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      descripcion TEXT,
      color TEXT DEFAULT '#888888',
      es_preset INTEGER DEFAULT 0,
      creado_en TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rrpp_grupos (
      rrpp_id TEXT NOT NULL,
      grupo_id TEXT NOT NULL,
      PRIMARY KEY (rrpp_id, grupo_id),
      FOREIGN KEY (rrpp_id) REFERENCES usuarios(id),
      FOREIGN KEY (grupo_id) REFERENCES grupos(id)
    );

    CREATE TABLE IF NOT EXISTS eventos (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      fecha TEXT NOT NULL,
      lugar TEXT NOT NULL,
      sala TEXT NOT NULL CHECK(sala IN ('velvet','lemon','zrrcus')),
      url_monsterticket TEXT NOT NULL,
      estado TEXT DEFAULT 'activo' CHECK(estado IN ('activo','cerrado','archivado')),
      entradas_restantes INTEGER DEFAULT NULL,
      oferta_expira TEXT DEFAULT NULL,
      umbral_fraude_escaneos INTEGER DEFAULT 5,
      umbral_fraude_minutos INTEGER DEFAULT 2,
      creado_en TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rrpp_eventos (
      id TEXT PRIMARY KEY,
      rrpp_id TEXT NOT NULL,
      evento_id TEXT NOT NULL,
      codigo_descuento TEXT NOT NULL,
      FOREIGN KEY (rrpp_id) REFERENCES usuarios(id),
      FOREIGN KEY (evento_id) REFERENCES eventos(id)
    );

    CREATE TABLE IF NOT EXISTS qr_codes (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      rrpp_id TEXT NOT NULL,
      evento_id TEXT NOT NULL,
      numero_flyer INTEGER NOT NULL,
      tipo_qr TEXT DEFAULT 'estandar' CHECK(tipo_qr IN ('estandar','con_logo')),
      creado_en TEXT DEFAULT (datetime('now')),
      lote_id TEXT DEFAULT NULL,
      bloqueado INTEGER DEFAULT 0,
      reclamado_por TEXT DEFAULT NULL,
      device_fp TEXT DEFAULT NULL,
      FOREIGN KEY (rrpp_id) REFERENCES usuarios(id),
      FOREIGN KEY (evento_id) REFERENCES eventos(id)
    );

    CREATE TABLE IF NOT EXISTS escaneos (
      id TEXT PRIMARY KEY,
      qr_id TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now')),
      ip_hash TEXT,
      user_agent TEXT,
      tipo_acceso TEXT DEFAULT 'fisico' CHECK(tipo_acceso IN ('fisico','enlace')),
      es_duplicado INTEGER DEFAULT 0,
      sospechoso INTEGER DEFAULT 0,
      motivo_sospecha TEXT DEFAULT NULL,
      device_fingerprint TEXT DEFAULT NULL,
      FOREIGN KEY (qr_id) REFERENCES qr_codes(id)
    );

    CREATE TABLE IF NOT EXISTS dispositivos_bloqueados (
      id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      evento_id TEXT NOT NULL,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS historico_eventos (
      id TEXT PRIMARY KEY,
      evento_id TEXT NOT NULL,
      rrpp_id TEXT NOT NULL,
      total_flyers INTEGER DEFAULT 0,
      flyers_activados INTEGER DEFAULT 0,
      total_escaneos INTEGER DEFAULT 0,
      escaneos_fisicos INTEGER DEFAULT 0,
      escaneos_enlace INTEGER DEFAULT 0,
      escaneos_duplicados INTEGER DEFAULT 0,
      escaneos_sospechosos INTEGER DEFAULT 0,
      exportado_en TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      usuario_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expira_en TEXT NOT NULL,
      creado_en TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );

    CREATE TABLE IF NOT EXISTS ml_datos (
      id TEXT PRIMARY KEY,
      escaneo_id TEXT NOT NULL,
      features TEXT NOT NULL,
      etiqueta TEXT DEFAULT NULL,
      creado_en TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (escaneo_id) REFERENCES escaneos(id)
    );
  `);

  console.log('Base de datos inicializada correctamente');
};

module.exports = { db, initDB };
