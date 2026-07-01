const { db } = require('../config/database');

const dashboardAdmin = (req, res) => {
  const totalEvents = db.prepare("SELECT COUNT(*) as total FROM eventos").get().total;
  const activeEvents = db.prepare("SELECT COUNT(*) as total FROM eventos WHERE estado = 'activo'").get().total;
  const totalRRPPs = db.prepare("SELECT COUNT(*) as total FROM usuarios WHERE rol = 'rrpp' AND activo = 1").get().total;
  const totalQRs = db.prepare("SELECT COUNT(*) as total FROM qr_codes").get().total;
  const totalScans = db.prepare("SELECT COUNT(*) as total FROM escaneos WHERE es_duplicado = 0 AND sospechoso = 0").get().total;
  const suspiciousScans = db.prepare("SELECT COUNT(*) as total FROM escaneos WHERE sospechoso = 1").get().total;
  const blockedQRs = db.prepare("SELECT COUNT(*) as total FROM qr_codes WHERE bloqueado = 1").get().total;

  const recentEvents = db.prepare(`
    SELECT e.*, COUNT(DISTINCT re.rrpp_id) as total_rrpps,
    COUNT(DISTINCT qr.id) as total_qrs,
    COUNT(DISTINCT CASE WHEN es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as total_escaneos
    FROM eventos e
    LEFT JOIN rrpp_eventos re ON e.id = re.evento_id
    LEFT JOIN qr_codes qr ON e.id = qr.evento_id
    LEFT JOIN escaneos es ON qr.id = es.qr_id
    GROUP BY e.id
    ORDER BY e.creado_en DESC
    LIMIT 5
  `).all();

  const fraudAlerts = db.prepare(`
    SELECT es.*, qr.token, qr.numero_flyer, u.nombre as rrpp_nombre, e.nombre as evento_nombre
    FROM escaneos es
    JOIN qr_codes qr ON es.qr_id = qr.id
    JOIN usuarios u ON qr.rrpp_id = u.id
    JOIN eventos e ON qr.evento_id = e.id
    WHERE es.sospechoso = 1
    ORDER BY es.timestamp DESC
    LIMIT 10
  `).all();

const suspiciousRRPPs = db.prepare(`
    SELECT u.nombre, e.nombre as evento,
    COUNT(DISTINCT qr.id) as total_qrs,
    COUNT(DISTINCT CASE WHEN es.id IS NOT NULL AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN qr.id END) as activados,
    ROUND(CAST(COUNT(DISTINCT CASE WHEN es.id IS NOT NULL AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN qr.id END) AS FLOAT) /
    NULLIF(COUNT(DISTINCT qr.id), 0) * 100, 1) as tasa
    FROM qr_codes qr
    JOIN usuarios u ON qr.rrpp_id = u.id
    JOIN eventos e ON qr.evento_id = e.id
    LEFT JOIN escaneos es ON es.qr_id = qr.id
    WHERE e.estado = 'activo'
    GROUP BY qr.rrpp_id, qr.evento_id
    HAVING tasa >= 80 AND total_qrs >= 10
    ORDER BY tasa DESC
  `).all();

  const systemHealth = {
    uptime: Math.floor(process.uptime()),
    memoria_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    node_version: process.version,
    timestamp: new Date().toISOString()
  };

  res.json({
    stats: { totalEvents, activeEvents, totalRRPPs, totalQRs, totalScans, suspiciousScans, blockedQRs },
    recentEvents,
    fraudAlerts,
    suspiciousRRPPs,
    systemHealth
  });
};

const dashboardJefe = (req, res) => {
  const eventos = db.prepare(`
    SELECT e.id, e.nombre, e.fecha, e.sala, e.estado,
    COUNT(DISTINCT re.rrpp_id) as total_rrpps,
    COUNT(DISTINCT qr.id) as total_qrs,
    COUNT(DISTINCT CASE WHEN es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as escaneos_validos,
    COUNT(DISTINCT CASE WHEN es.tipo_acceso = 'fisico' AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as escaneos_fisicos,
    COUNT(DISTINCT CASE WHEN es.tipo_acceso = 'enlace' AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as escaneos_enlace
    FROM eventos e
    LEFT JOIN rrpp_eventos re ON e.id = re.evento_id
    LEFT JOIN qr_codes qr ON e.id = qr.evento_id
    LEFT JOIN escaneos es ON qr.id = es.qr_id
    GROUP BY e.id
    ORDER BY e.fecha DESC
  `).all();

  res.json({ eventos });
};

const eventRanking = (req, res) => {
  const { evento_id } = req.params;

  const evento = db.prepare('SELECT * FROM eventos WHERE id = ?').get(evento_id);
  if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });

  const ranking = db.prepare(`
    SELECT u.id, u.nombre, u.foto_perfil, re.codigo_descuento,
    COUNT(DISTINCT qr.id) as total_qrs,
    COUNT(DISTINCT CASE WHEN es.id IS NOT NULL AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN qr.id END) as flyers_activados,
    COUNT(DISTINCT CASE WHEN es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as escaneos_validos,
    COUNT(DISTINCT CASE WHEN es.tipo_acceso = 'fisico' AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as escaneos_fisicos,
    COUNT(DISTINCT CASE WHEN es.tipo_acceso = 'enlace' AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as escaneos_enlace,
    COUNT(DISTINCT CASE WHEN es.sospechoso = 1 THEN es.id END) as escaneos_sospechosos,
    ROUND(CAST(COUNT(DISTINCT CASE WHEN es.id IS NOT NULL AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN qr.id END) AS FLOAT) /
    NULLIF(COUNT(DISTINCT qr.id), 0) * 100, 1) as tasa_activacion
    FROM rrpp_eventos re
    JOIN usuarios u ON re.rrpp_id = u.id
    LEFT JOIN qr_codes qr ON qr.rrpp_id = u.id AND qr.evento_id = ?
    LEFT JOIN escaneos es ON es.qr_id = qr.id
    WHERE re.evento_id = ?
    GROUP BY u.id
    ORDER BY flyers_activados DESC
  `).all(evento_id, evento_id);

  const scansByHour = db.prepare(`
    SELECT strftime('%H', es.timestamp) as hora,
    COUNT(CASE WHEN es.es_duplicado = 0 AND es.sospechoso = 0 THEN 1 END) as escaneos
    FROM escaneos es
    JOIN qr_codes qr ON es.qr_id = qr.id
    WHERE qr.evento_id = ?
    GROUP BY hora
    ORDER BY hora ASC
  `).all(evento_id);

  res.json({ evento, ranking, escaneosPorHora: scansByHour });
};

const dashboardRRPP = (req, res) => {
  const rrpp_id = req.usuario.id;

  const eventos = db.prepare(`
    SELECT e.id, e.nombre, e.fecha, e.sala, e.estado, re.codigo_descuento,
    COUNT(DISTINCT qr.id) as total_qrs,
    COUNT(DISTINCT CASE WHEN es.id IS NOT NULL AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN qr.id END) as flyers_activados,
    COUNT(DISTINCT CASE WHEN es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as escaneos_validos,
    COUNT(DISTINCT CASE WHEN es.tipo_acceso = 'fisico' AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as escaneos_fisicos,
    COUNT(DISTINCT CASE WHEN es.tipo_acceso = 'enlace' AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as escaneos_enlace
    FROM rrpp_eventos re
    JOIN eventos e ON re.evento_id = e.id
    LEFT JOIN qr_codes qr ON qr.evento_id = e.id AND qr.rrpp_id = ?
    LEFT JOIN escaneos es ON es.qr_id = qr.id
    WHERE re.rrpp_id = ?
    GROUP BY e.id
    ORDER BY e.fecha DESC
  `).all(rrpp_id, rrpp_id);

  const historico = db.prepare(`
  SELECT he.*, e.nombre as evento_nombre, e.sala, e.fecha, e.estado as sala_estado
  FROM historico_eventos he
  JOIN eventos e ON he.evento_id = e.id
  WHERE he.rrpp_id = ?
  ORDER BY e.fecha DESC
`).all(rrpp_id);

  const currentPosition = (evento_id) => {
    const ranking = db.prepare(`
      SELECT rrpp_id, COUNT(DISTINCT CASE WHEN es.id IS NOT NULL AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN qr.id END) as flyers_activados
      FROM qr_codes qr
      LEFT JOIN escaneos es ON es.qr_id = qr.id
      WHERE qr.evento_id = ?
      GROUP BY qr.rrpp_id
      ORDER BY flyers_activados DESC
    `).all(evento_id);
    const pos = ranking.findIndex(r => r.rrpp_id === rrpp_id);
    return { posicion: pos + 1, total: ranking.length };
  };

  const eventsWithPosition = eventos.map(e => ({
    ...e,
    ...currentPosition(e.id)
  }));

  res.json({ eventos: eventsWithPosition, historico });
};

const realtimeScans = (req, res) => {
  const { evento_id } = req.params;
  const { desde } = req.query;

  let query = `
    SELECT es.id, es.timestamp, es.tipo_acceso, es.es_duplicado, es.sospechoso,
    qr.numero_flyer, u.nombre as rrpp_nombre
    FROM escaneos es
    JOIN qr_codes qr ON es.qr_id = qr.id
    JOIN usuarios u ON qr.rrpp_id = u.id
    WHERE qr.evento_id = ?
  `;
  const params = [evento_id];

  if (desde) {
    query += ' AND es.timestamp > ?';
    params.push(desde);
  }

  query += ' ORDER BY es.timestamp DESC LIMIT 50';

  const escaneos = db.prepare(query).all(...params);
  const lastUpdate = new Date().toISOString();

  res.json({ escaneos, ultimaActualizacion: lastUpdate });
};

const exportAlertsCSV = (req, res) => {
  const alertas = db.prepare(`
    SELECT es.timestamp, u.nombre as rrpp, e.nombre as evento,
    qr.numero_flyer, es.tipo_acceso, es.motivo_sospecha
    FROM escaneos es
    JOIN qr_codes qr ON es.qr_id = qr.id
    JOIN usuarios u ON qr.rrpp_id = u.id
    JOIN eventos e ON qr.evento_id = e.id
    WHERE es.sospechoso = 1
    ORDER BY es.timestamp DESC
  `).all();

  const header = 'Hora,RRPP,Evento,Flyer,Tipo,Motivo\n';
  const rows = alertas.map(a =>
    `"${a.timestamp}","${a.rrpp}","${a.evento}","#${a.numero_flyer}","${a.tipo_acceso}","${a.motivo_sospecha || 'reutilizacion'}"`
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="alertas-fraude.csv"');
  res.send('﻿' + header + rows);
};

module.exports = { dashboardAdmin, dashboardJefe, eventRanking, dashboardRRPP, realtimeScans, exportAlertsCSV };
