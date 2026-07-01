const bcrypt = require('bcryptjs');
const { db } = require('../config/database');
const { generateId } = require('../utils/helpers');

const listRRPPs = (req, res) => {
  const rrpps = db.prepare(`
    SELECT u.id, u.nombre, u.usuario, u.email, u.foto_perfil, u.activo, u.creado_en, u.ultimo_acceso,
    GROUP_CONCAT(g.nombre) as grupos
    FROM usuarios u
    LEFT JOIN rrpp_grupos rg ON u.id = rg.rrpp_id
    LEFT JOIN grupos g ON rg.grupo_id = g.id
    WHERE u.rol = 'rrpp'
    GROUP BY u.id
    ORDER BY u.nombre ASC
  `).all();
  res.json(rrpps);
};

const getRRPP = (req, res) => {
  const { id } = req.params;
  const rrpp = db.prepare(`
    SELECT u.id, u.nombre, u.usuario, u.email, u.foto_perfil, u.activo, u.creado_en, u.ultimo_acceso
    FROM usuarios u WHERE u.id = ? AND u.rol = 'rrpp'
  `).get(id);
  if (!rrpp) return res.status(404).json({ error: 'RRPP no encontrado' });

  const grupos = db.prepare(`
    SELECT g.id, g.nombre, g.color, g.es_preset
    FROM grupos g JOIN rrpp_grupos rg ON g.id = rg.grupo_id
    WHERE rg.rrpp_id = ?
  `).all(id);

  const historico = db.prepare(`
    SELECT he.*, e.nombre as evento_nombre, e.sala, e.fecha
    FROM historico_eventos he
    JOIN eventos e ON he.evento_id = e.id
    WHERE he.rrpp_id = ?
    ORDER BY e.fecha DESC
  `).all(id);

  res.json({ ...rrpp, grupos, historico });
};

const createRRPP = (req, res) => {
  const { nombre, usuario, password, email, grupos } = req.body;
  if (!nombre || !usuario || !password) {
    return res.status(400).json({ error: 'Nombre, usuario y contraseña son obligatorios' });
  }
  const exists = db.prepare('SELECT id FROM usuarios WHERE usuario = ?').get(usuario);
  if (exists) return res.status(409).json({ error: 'El usuario ya existe' });

  const id = generateId();
  const hash = bcrypt.hashSync(password, 12);
  db.prepare(`
    INSERT INTO usuarios (id, nombre, usuario, password_hash, email, rol)
    VALUES (?, ?, ?, ?, ?, 'rrpp')
  `).run(id, nombre, usuario, hash, email || null);

  if (grupos && grupos.length > 0) {
    grupos.forEach(grupoId => {
      const grupo = db.prepare('SELECT id FROM grupos WHERE id = ?').get(grupoId);
      if (grupo) {
        db.prepare('INSERT OR IGNORE INTO rrpp_grupos (rrpp_id, grupo_id) VALUES (?, ?)').run(id, grupoId);
      }
    });
  }

  res.status(201).json({ mensaje: 'RRPP creado correctamente', id });
};

const editRRPP = (req, res) => {
  const { id } = req.params;
  const { nombre, email, activo, grupos } = req.body;
  const rrpp = db.prepare('SELECT id FROM usuarios WHERE id = ? AND rol = ?').get(id, 'rrpp');
  if (!rrpp) return res.status(404).json({ error: 'RRPP no encontrado' });

  if (nombre || email !== undefined || activo !== undefined) {
    db.prepare(`
      UPDATE usuarios SET
        nombre = COALESCE(?, nombre),
        email = COALESCE(?, email),
        activo = COALESCE(?, activo)
      WHERE id = ?
    `).run(nombre || null, email || null, activo !== undefined ? activo : null, id);

    if (activo === 0 || activo === '0') {
      db.prepare('DELETE FROM refresh_tokens WHERE usuario_id = ?').run(id);
    }
  }

  if (grupos !== undefined) {
    db.prepare('DELETE FROM rrpp_grupos WHERE rrpp_id = ?').run(id);
    grupos.forEach(grupoId => {
      db.prepare('INSERT OR IGNORE INTO rrpp_grupos (rrpp_id, grupo_id) VALUES (?, ?)').run(id, grupoId);
    });
  }

  res.json({ mensaje: 'RRPP actualizado correctamente' });
};

const resetPassword = (req, res) => {
  const { id } = req.params;
  const { passwordNueva } = req.body;
  if (!passwordNueva || passwordNueva.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  const rrpp = db.prepare('SELECT id FROM usuarios WHERE id = ? AND rol = ?').get(id, 'rrpp');
  if (!rrpp) return res.status(404).json({ error: 'RRPP no encontrado' });

  const hash = bcrypt.hashSync(passwordNueva, 12);
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(hash, id);
  db.prepare('DELETE FROM refresh_tokens WHERE usuario_id = ?').run(id);

  res.json({ mensaje: 'Contraseña actualizada correctamente' });
};

const listGroups = (req, res) => {
  const grupos = db.prepare('SELECT * FROM grupos ORDER BY es_preset DESC, nombre ASC').all();
  res.json(grupos);
};

const createGroup = (req, res) => {
  const { nombre, descripcion, color } = req.body;
  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const id = generateId();
  db.prepare('INSERT INTO grupos (id, nombre, descripcion, color, es_preset) VALUES (?, ?, ?, ?, 0)')
    .run(id, nombre, descripcion || null, color || '#888888');
  res.status(201).json({ mensaje: 'Grupo creado correctamente', id });
};

const editGroup = (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion, color } = req.body;
  db.prepare(`
    UPDATE grupos SET
      nombre = COALESCE(?, nombre),
      descripcion = COALESCE(?, descripcion),
      color = COALESCE(?, color)
    WHERE id = ?
  `).run(nombre || null, descripcion || null, color || null, id);
  res.json({ mensaje: 'Grupo actualizado correctamente' });
};

const deleteGroup = (req, res) => {
  const { id } = req.params;
  const grupo = db.prepare('SELECT * FROM grupos WHERE id = ?').get(id);
  if (!grupo) return res.status(404).json({ error: 'Grupo no encontrado' });
  if (grupo.es_preset) return res.status(403).json({ error: 'No se pueden eliminar los grupos preset' });
  db.prepare('DELETE FROM rrpp_grupos WHERE grupo_id = ?').run(id);
  db.prepare('DELETE FROM grupos WHERE id = ?').run(id);
  res.json({ mensaje: 'Grupo eliminado correctamente' });
};

const listSuspensions = (req, res) => {
  const suspended = db.prepare(`
    SELECT id, nombre, usuario, email, activo, intentos_login, suspension_hasta, bloqueado_permanente
    FROM usuarios
    WHERE rol = 'rrpp' AND (suspension_hasta IS NOT NULL OR bloqueado_permanente = 1)
    ORDER BY bloqueado_permanente DESC, suspension_hasta ASC
  `).all();
  res.json(suspended);
};

const liftSanction = (req, res) => {
  const { id } = req.params;
  db.prepare(`
    UPDATE usuarios SET suspension_hasta = NULL, bloqueado_permanente = 0, intentos_login = 0
    WHERE id = ?
  `).run(id);
  res.json({ mensaje: 'Sanción levantada correctamente' });
};

const deleteRRPP = (req, res) => {
  const { id } = req.params;
  const rrpp = db.prepare('SELECT id FROM usuarios WHERE id = ? AND rol = ?').get(id, 'rrpp');
  if (!rrpp) return res.status(404).json({ error: 'RRPP no encontrado' });

  db.prepare('DELETE FROM refresh_tokens WHERE usuario_id = ?').run(id);
  db.prepare('DELETE FROM rrpp_grupos WHERE rrpp_id = ?').run(id);
  db.prepare('DELETE FROM rrpp_eventos WHERE rrpp_id = ?').run(id);
  db.prepare('DELETE FROM historico_eventos WHERE rrpp_id = ?').run(id);
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);

  res.json({ mensaje: 'RRPP eliminado correctamente' });
};

module.exports = { listRRPPs, getRRPP, createRRPP, editRRPP, resetPassword, listGroups, createGroup, editGroup, deleteGroup, listSuspensions, liftSanction, deleteRRPP };
