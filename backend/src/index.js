require('dotenv').config({ quiet: true });
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { initDB, db } = require('./config/database');
const { generateId } = require('./utils/helpers');
const { initAlerts } = require('./utils/alertas');
const { automaticBackup } = require('./utils/historico');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = process.env.FRONTEND_DIR || path.join(__dirname, '../../frontend');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(FRONTEND_DIR));

// Rate limiter to prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  message: { error: 'Demasiadas peticiones, espera un momento' }
});
app.use(limiter);

initDB();

// Create initial admin user and preset groups if they don't exist yet
const createInitialAdmin = () => {
  const adminExists = db.prepare('SELECT id FROM usuarios WHERE rol = ?').get('admin');
  if (!adminExists) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin1234', 12);
    db.prepare(`
      INSERT INTO usuarios (id, nombre, usuario, password_hash, email, rol)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      generateId(),
      'Administrador',
      process.env.ADMIN_USERNAME || 'admin',
      hash,
      process.env.ADMIN_EMAIL || '',
      'admin'
    );
    console.log('Usuario admin creado correctamente');
  }

  const presetsExist = db.prepare('SELECT id FROM grupos WHERE es_preset = 1').get();
  if (!presetsExist) {
    const presets = [
      { nombre: 'Velvet', color: '#D4537E' },
      { nombre: 'Lemon', color: '#EF9F27' },
      { nombre: 'Zrrcus', color: '#E24B4A' }
    ];
    presets.forEach(p => {
      db.prepare('INSERT INTO grupos (id, nombre, color, es_preset) VALUES (?, ?, ?, 1)')
        .run(generateId(), p.nombre, p.color);
    });
    console.log('Grupos preset creados: Velvet, Lemon, Zrrcus');
  }
};

createInitialAdmin();
initAlerts();
automaticBackup();

app.use('/api/auth', require('./routes/auth'));
app.use('/api/rrpps', require('./routes/rrpp'));
app.use('/api/eventos', require('./routes/eventos'));
app.use('/api/qrs', require('./routes/qr'));
app.use('/api/panel', require('./routes/panel'));
app.use('/api/informes', require('./routes/informes'));
app.use('/api/flyer', require('./routes/flyer'));
app.use('/qr', require('./routes/landing'));
app.get('/privacidad', require('./controllers/landingController').privacyPage);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mensaje: 'FlyerTrack funcionando',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memoria_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`FlyerTrack corriendo en http://localhost:${PORT}`);
  console.log(`Entorno: ${process.env.NODE_ENV}`);
});

module.exports = app;