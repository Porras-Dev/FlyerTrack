const { db } = require('../config/database');
const { generateId } = require('../utils/helpers');

const listEvents = (req, res) => {
  const eventos = db.prepare(`
    SELECT e.*,
    COUNT(DISTINCT re.rrpp_id) as total_rrpps,
    COUNT(DISTINCT qr.id) as total_qrs,
    COUNT(DISTINCT es.id) as total_escaneos
    FROM eventos e
    LEFT JOIN rrpp_eventos re ON e.id = re.evento_id
    LEFT JOIN qr_codes qr ON e.id = qr.evento_id
    LEFT JOIN escaneos es ON qr.id = es.qr_id AND es.es_duplicado = 0 AND es.sospechoso = 0
    GROUP BY e.id
    ORDER BY e.fecha DESC
  `).all();
  res.json(eventos);
};

const getEvent = (req, res) => {
  const { id } = req.params;
  const evento = db.prepare('SELECT * FROM eventos WHERE id = ?').get(id);
  if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });

  const rrpps = db.prepare(`
    SELECT u.id, u.nombre, u.usuario, u.foto_perfil, re.codigo_descuento,
    COUNT(DISTINCT qr.id) as total_qrs,
    COUNT(DISTINCT CASE WHEN es.es_duplicado = 0 AND es.sospechoso = 0 THEN qr.id END) as flyers_activados,
    COUNT(DISTINCT CASE WHEN es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as escaneos_validos,
    COUNT(DISTINCT CASE WHEN es.tipo_acceso = 'fisico' AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as escaneos_fisicos,
    COUNT(DISTINCT CASE WHEN es.tipo_acceso = 'enlace' AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as escaneos_enlace,
    COUNT(DISTINCT CASE WHEN es.sospechoso = 1 THEN es.id END) as escaneos_sospechosos
    FROM rrpp_eventos re
    JOIN usuarios u ON re.rrpp_id = u.id
    LEFT JOIN qr_codes qr ON qr.rrpp_id = u.id AND qr.evento_id = ?
    LEFT JOIN escaneos es ON es.qr_id = qr.id
    WHERE re.evento_id = ?
    GROUP BY u.id
    ORDER BY flyers_activados DESC
  `).all(id, id);

  res.json({ ...evento, rrpps });
};

const createEvent = (req, res) => {
  const { nombre, fecha, lugar, sala, url_monsterticket, entradas_restantes, oferta_expira, umbral_fraude_escaneos, umbral_fraude_minutos } = req.body;

  if (!nombre || !fecha || !lugar || !sala || !url_monsterticket) {
    return res.status(400).json({ error: 'Faltan campos obligatorios: nombre, fecha, lugar, sala, url_monsterticket' });
  }

  if (!['velvet', 'lemon', 'zrrcus'].includes(sala)) {
    return res.status(400).json({ error: 'La sala debe ser velvet, lemon o zrrcus' });
  }

  const id = generateId();
  db.prepare(`
    INSERT INTO eventos (id, nombre, fecha, lugar, sala, url_monsterticket, entradas_restantes, oferta_expira, umbral_fraude_escaneos, umbral_fraude_minutos)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, nombre, fecha, lugar, sala, url_monsterticket,
    entradas_restantes || null,
    oferta_expira || null,
    umbral_fraude_escaneos || 5,
    umbral_fraude_minutos || 2
  );

  res.status(201).json({ mensaje: 'Evento creado correctamente', id });
};

const editEvent = (req, res) => {
  const { id } = req.params;
  const evento = db.prepare('SELECT id FROM eventos WHERE id = ?').get(id);
  if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });

  const { nombre, fecha, lugar, sala, url_monsterticket, estado, entradas_restantes, oferta_expira, umbral_fraude_escaneos, umbral_fraude_minutos } = req.body;

  if (sala && !['velvet', 'lemon', 'zrrcus'].includes(sala)) {
    return res.status(400).json({ error: 'La sala debe ser velvet, lemon o zrrcus' });
  }

  db.prepare(`
    UPDATE eventos SET
      nombre = COALESCE(?, nombre),
      fecha = COALESCE(?, fecha),
      lugar = COALESCE(?, lugar),
      sala = COALESCE(?, sala),
      url_monsterticket = COALESCE(?, url_monsterticket),
      estado = COALESCE(?, estado),
      entradas_restantes = COALESCE(?, entradas_restantes),
      oferta_expira = COALESCE(?, oferta_expira),
      umbral_fraude_escaneos = COALESCE(?, umbral_fraude_escaneos),
      umbral_fraude_minutos = COALESCE(?, umbral_fraude_minutos)
    WHERE id = ?
  `).run(nombre||null, fecha||null, lugar||null, sala||null, url_monsterticket||null, estado||null, entradas_restantes||null, oferta_expira||null, umbral_fraude_escaneos||null, umbral_fraude_minutos||null, id);

  res.json({ mensaje: 'Evento actualizado correctamente' });
};

const assignRRPP = (req, res) => {
  const { id } = req.params;
  const { rrpp_id, codigo_descuento } = req.body;

  if (!rrpp_id || !codigo_descuento) {
    return res.status(400).json({ error: 'rrpp_id y codigo_descuento son obligatorios' });
  }

  const evento = db.prepare('SELECT id FROM eventos WHERE id = ?').get(id);
  if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });

  const rrpp = db.prepare('SELECT id FROM usuarios WHERE id = ? AND rol = ?').get(rrpp_id, 'rrpp');
  if (!rrpp) return res.status(404).json({ error: 'RRPP no encontrado' });

  const alreadyAssigned = db.prepare('SELECT id FROM rrpp_eventos WHERE rrpp_id = ? AND evento_id = ?').get(rrpp_id, id);
  if (alreadyAssigned) return res.status(409).json({ error: 'El RRPP ya está asignado a este evento' });

  const assignmentId = generateId();
  db.prepare('INSERT INTO rrpp_eventos (id, rrpp_id, evento_id, codigo_descuento) VALUES (?, ?, ?, ?)')
    .run(assignmentId, rrpp_id, id, codigo_descuento);

  res.status(201).json({ mensaje: 'RRPP asignado correctamente' });
};

const unassignRRPP = (req, res) => {
  const { id, rrpp_id } = req.params;
  db.prepare('DELETE FROM rrpp_eventos WHERE evento_id = ? AND rrpp_id = ?').run(id, rrpp_id);
  res.json({ mensaje: 'RRPP desasignado correctamente' });
};

const closeEvent = (req, res) => {
  const { id } = req.params;
  const evento = db.prepare('SELECT * FROM eventos WHERE id = ?').get(id);
  if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });

  const rrpps = db.prepare('SELECT rrpp_id FROM rrpp_eventos WHERE evento_id = ?').all(id);

  rrpps.forEach(({ rrpp_id }) => {
    const stats = db.prepare(`
      SELECT
        COUNT(DISTINCT qr.id) as total_flyers,
        COUNT(DISTINCT CASE WHEN es.id IS NOT NULL AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN qr.id END) as flyers_activados,
        COUNT(DISTINCT CASE WHEN es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as total_escaneos,
        COUNT(DISTINCT CASE WHEN es.tipo_acceso = 'fisico' AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as escaneos_fisicos,
        COUNT(DISTINCT CASE WHEN es.tipo_acceso = 'enlace' AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as escaneos_enlace,
        COUNT(DISTINCT CASE WHEN es.es_duplicado = 1 THEN es.id END) as escaneos_duplicados,
        COUNT(DISTINCT CASE WHEN es.sospechoso = 1 THEN es.id END) as escaneos_sospechosos
      FROM qr_codes qr
      LEFT JOIN escaneos es ON es.qr_id = qr.id
      WHERE qr.evento_id = ? AND qr.rrpp_id = ?
    `).get(id, rrpp_id);

    db.prepare(`
      INSERT INTO historico_eventos (id, evento_id, rrpp_id, total_flyers, flyers_activados, total_escaneos, escaneos_fisicos, escaneos_enlace, escaneos_duplicados, escaneos_sospechosos)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(generateId(), id, rrpp_id, stats.total_flyers, stats.flyers_activados, stats.total_escaneos, stats.escaneos_fisicos, stats.escaneos_enlace, stats.escaneos_duplicados, stats.escaneos_sospechosos);
  });

  db.prepare("UPDATE eventos SET estado = 'cerrado' WHERE id = ?").run(id);
  res.json({ mensaje: 'Evento cerrado y datos guardados en histórico correctamente' });
};

const deleteEvent = (req, res) => {
  const { id } = req.params;
  const evento = db.prepare('SELECT id FROM eventos WHERE id = ?').get(id);
  if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });

  db.prepare('DELETE FROM escaneos WHERE qr_id IN (SELECT id FROM qr_codes WHERE evento_id = ?)').run(id);
  db.prepare('DELETE FROM qr_codes WHERE evento_id = ?').run(id);
  db.prepare('DELETE FROM rrpp_eventos WHERE evento_id = ?').run(id);
  db.prepare('DELETE FROM historico_eventos WHERE evento_id = ?').run(id);
  db.prepare('DELETE FROM eventos WHERE id = ?').run(id);

  res.json({ mensaje: 'Evento eliminado correctamente' });
};

module.exports = { listEvents, getEvent, createEvent, editEvent, assignRRPP, unassignRRPP, closeEvent, deleteEvent };
