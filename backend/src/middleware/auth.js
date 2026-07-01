const jwt = require('jsonwebtoken');
const { db } = require('../config/database');

const verifyToken = (req, res, next) => {
  const tokenQuery = req.query.token;
    if (tokenQuery) {
      req.headers.authorization = `Bearer ${tokenQuery}`;
    }
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido o expirado' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.usuario.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso restringido a administradores' });
  }
  next();
};

const adminOrManagerOnly = (req, res, next) => {
  if (!['admin', 'jefe'].includes(req.usuario.rol)) {
    return res.status(403).json({ error: 'Acceso restringido' });
  }
  next();
};

const verifyRefreshToken = (req, res, next) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token no proporcionado' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const tokenDB = db.prepare('SELECT * FROM refresh_tokens WHERE token = ? AND usuario_id = ?')
      .get(refreshToken, decoded.id);

    if (!tokenDB) {
      return res.status(403).json({ error: 'Refresh token inválido' });
    }

    if (new Date(tokenDB.expira_en) < new Date()) {
      db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refreshToken);
      return res.status(403).json({ error: 'Refresh token expirado' });
    }

    req.usuarioRefresh = decoded;
    req.refreshToken = refreshToken;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Refresh token inválido' });
  }
};

module.exports = { verifyToken, adminOnly, adminOrManagerOnly, verifyRefreshToken };
