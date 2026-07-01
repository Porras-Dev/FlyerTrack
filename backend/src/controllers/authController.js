const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../config/database');
const { generateId } = require('../utils/helpers');

const generateTokens = (usuario) => {
  const accessToken = jwt.sign(
    { id: usuario.id, usuario: usuario.usuario, rol: usuario.rol, nombre: usuario.nombre },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
  );

  const refreshToken = jwt.sign(
    { id: usuario.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  db.prepare('DELETE FROM refresh_tokens WHERE usuario_id = ?').run(usuario.id);
  db.prepare('INSERT INTO refresh_tokens (id, usuario_id, token, expira_en) VALUES (?, ?, ?, ?)')
    .run(generateId(), usuario.id, refreshToken, expiresAt.toISOString());

  return { accessToken, refreshToken };
};

const login = async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) return res.status(400).json({ error: 'Usuario y contraseña obligatorios' });

  const user = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(usuario);

  if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

  if (user.rol !== 'admin') {
    if (user.bloqueado_permanente) {
      return res.status(403).json({ error: 'Cuenta bloqueada permanentemente por demasiados intentos fallidos. Contacta con el administrador.' });
    }

    if (user.suspension_hasta) {
      const now = new Date();
      const suspendedUntil = new Date(user.suspension_hasta);
      if (now < suspendedUntil) {
        const minutes = Math.ceil((suspendedUntil - now) / 60000);
        return res.status(403).json({ error: `Cuenta suspendida. Podrás intentarlo de nuevo en ${minutes} minutos.` });
      } else {
        db.prepare('UPDATE usuarios SET suspension_hasta = NULL, intentos_login = 0 WHERE id = ?').run(user.id);
      }
    }

    if (!user.activo) return res.status(401).json({ error: 'Cuenta desactivada. Contacta con el administrador.' });
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);

  if (!isPasswordValid) {
    if (user.rol !== 'admin') {
      const attempts = (user.intentos_login || 0) + 1;

      if (attempts >= 5) {
        if (user.suspension_hasta) {
          db.prepare('UPDATE usuarios SET bloqueado_permanente = 1, intentos_login = 0, suspension_hasta = NULL WHERE id = ?').run(user.id);
          return res.status(403).json({ error: 'Cuenta bloqueada permanentemente por demasiados intentos fallidos. Contacta con el administrador.' });
        } else {
          const suspendedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
          db.prepare('UPDATE usuarios SET intentos_login = 0, suspension_hasta = ? WHERE id = ?').run(suspendedUntil, user.id);
          return res.status(403).json({ error: 'Demasiados intentos fallidos. Cuenta suspendida durante 1 hora.' });
        }
      } else {
        db.prepare('UPDATE usuarios SET intentos_login = ? WHERE id = ?').run(attempts, user.id);
      }
    }
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  db.prepare('UPDATE usuarios SET intentos_login = 0, suspension_hasta = NULL, ultimo_acceso = ? WHERE id = ?')
    .run(new Date().toISOString().replace('T', ' ').substring(0, 19), user.id);

  const accessToken = jwt.sign(
    { id: user.id, usuario: user.usuario, rol: user.rol, nombre: user.nombre },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
  );

  const refreshToken = jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  const refreshId = generateId();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO refresh_tokens (id, usuario_id, token, expira_en) VALUES (?, ?, ?, ?)')
    .run(refreshId, user.id, refreshToken, expiresAt);

  res.json({
    mensaje: 'Login correcto',
    usuario: { id: user.id, nombre: user.nombre, usuario: user.usuario, rol: user.rol, foto_perfil: user.foto_perfil },
    accessToken,
    refreshToken
  });
};

const refreshToken = (req, res) => {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ? AND activo = 1')
    .get(req.usuarioRefresh.id);

  if (!usuario) {
    return res.status(403).json({ error: 'Usuario no encontrado' });
  }

  db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(req.refreshToken);

  const tokens = generateTokens(usuario);

  res.json({
    mensaje: 'Token renovado',
    ...tokens
  });
};

const logout = (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refreshToken);
  }
  res.json({ mensaje: 'Sesión cerrada correctamente' });
};

const profile = (req, res) => {
  const usuario = db.prepare('SELECT id, nombre, usuario, email, rol, foto_perfil, creado_en, ultimo_acceso FROM usuarios WHERE id = ?')
    .get(req.usuario.id);

  if (!usuario) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }

  res.json(usuario);
};

const changePassword = (req, res) => {
  const { passwordActual, passwordNueva } = req.body;

  if (!passwordActual || !passwordNueva) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  if (passwordNueva.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);
  const isPasswordValid = bcrypt.compareSync(passwordActual, usuario.password_hash);

  if (!isPasswordValid) {
    return res.status(401).json({ error: 'Contraseña actual incorrecta' });
  }

  const newHash = bcrypt.hashSync(passwordNueva, 12);
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(newHash, req.usuario.id);
  db.prepare('DELETE FROM refresh_tokens WHERE usuario_id = ?').run(req.usuario.id);

  res.json({ mensaje: 'Contraseña cambiada correctamente' });
};

module.exports = { login, refreshToken, logout, profile, changePassword };
