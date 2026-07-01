const PDFDocument = require('pdfkit');
const { db } = require('../config/database');
const { formatDate } = require('../utils/helpers');

const generateEventReport = (req, res) => {
  const { evento_id } = req.params;

  const evento = db.prepare('SELECT * FROM eventos WHERE id = ?').get(evento_id);
  if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });

  const ranking = db.prepare(`
    SELECT u.nombre, re.codigo_descuento,
    COUNT(DISTINCT qr.id) as total_qrs,
    COUNT(DISTINCT CASE WHEN es.id IS NOT NULL AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN qr.id END) as flyers_activados,
    COUNT(DISTINCT CASE WHEN es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as escaneos_validos,
    COUNT(DISTINCT CASE WHEN es.tipo_acceso = 'fisico' AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as escaneos_fisicos,
    COUNT(DISTINCT CASE WHEN es.tipo_acceso = 'enlace' AND es.es_duplicado = 0 AND es.sospechoso = 0 THEN es.id END) as escaneos_enlace,
    COUNT(DISTINCT CASE WHEN es.sospechoso = 1 THEN es.id END) as sospechosos,
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

  const totals = {
    total_qrs: ranking.reduce((s, r) => s + r.total_qrs, 0),
    flyers_activados: ranking.reduce((s, r) => s + r.flyers_activados, 0),
    escaneos_validos: ranking.reduce((s, r) => s + r.escaneos_validos, 0),
    escaneos_fisicos: ranking.reduce((s, r) => s + r.escaneos_fisicos, 0),
    escaneos_enlace: ranking.reduce((s, r) => s + r.escaneos_enlace, 0),
    sospechosos: ranking.reduce((s, r) => s + r.sospechosos, 0)
  };

  const roomColors = { velvet: '#D4537E', lemon: '#EFB827', zrrcus: '#E8732A' };
  const roomColor = roomColors[evento.sala] || '#333333';

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Informe_${evento.nombre.replace(/\s+/g, '_')}.pdf"`);
  doc.pipe(res);

  doc.rect(0, 0, doc.page.width, 120).fill(roomColor);
  doc.fillColor('white').fontSize(24).font('Helvetica-Bold').text(evento.nombre, 50, 35);
  doc.fontSize(12).font('Helvetica').text(`${evento.sala.toUpperCase()} — ${evento.lugar}`, 50, 68);
  doc.fontSize(11).text(`Fecha: ${new Date(evento.fecha).toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`, 50, 88);

  doc.moveDown(5);
  doc.fillColor('#333333').fontSize(16).font('Helvetica-Bold').text('Resumen general', 50, 140);
  doc.moveTo(50, 160).lineTo(545, 160).strokeColor(roomColor).lineWidth(2).stroke();

  const stats = [
    ['QRs generados', totals.total_qrs],
    ['Flyers activados', totals.flyers_activados],
    ['Escaneos válidos', totals.escaneos_validos],
    ['Escaneos físicos', totals.escaneos_fisicos],
    ['Accesos por enlace', totals.escaneos_enlace],
    ['Sospechosos', totals.sospechosos]
  ];

  let x = 50, y = 175;
  stats.forEach(([label, value], i) => {
    if (i === 3) { x = 300; y = 175; }
    doc.fontSize(10).font('Helvetica').fillColor('#666666').text(label, x, y);
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#333333').text(String(value), x, y + 14);
    y += 50;
  });

  doc.moveDown(2);
  let rankingY = 340;
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#333333').text('Ranking de RRPPs', 50, rankingY);
  doc.moveTo(50, rankingY + 20).lineTo(545, rankingY + 20).strokeColor(roomColor).lineWidth(2).stroke();
  rankingY += 35;

  const headers = ['Pos', 'RRPP', 'QRs', 'Activados', 'Válidos', 'Físicos', 'Enlace', 'Tasa'];
  const colWidths = [30, 130, 40, 60, 50, 50, 50, 45];
  let colX = 50;

  doc.fontSize(9).font('Helvetica-Bold').fillColor('white');
  doc.rect(50, rankingY, 495, 18).fill(roomColor);
  headers.forEach((h, i) => {
    doc.fillColor('white').text(h, colX + 3, rankingY + 4, { width: colWidths[i] });
    colX += colWidths[i];
  });
  rankingY += 18;

  ranking.forEach((rrpp, idx) => {
    if (idx % 2 === 0) doc.rect(50, rankingY, 495, 18).fill('#f5f5f5');
    colX = 50;
    const row = [idx + 1, rrpp.nombre, rrpp.total_qrs, rrpp.flyers_activados, rrpp.escaneos_validos, rrpp.escaneos_fisicos, rrpp.escaneos_enlace, `${rrpp.tasa_activacion}%`];
    doc.fontSize(9).font('Helvetica').fillColor('#333333');
    row.forEach((val, i) => {
      doc.text(String(val), colX + 3, rankingY + 4, { width: colWidths[i] });
      colX += colWidths[i];
    });
    rankingY += 18;
  });

  rankingY += 20;
  doc.fontSize(10).font('Helvetica').fillColor('#999999')
    .text(`Informe generado el ${new Date().toLocaleString('es-ES')} — FlyerTrack`, 50, rankingY);

  doc.end();
};

const exportCSV = (req, res) => {
  const { evento_id } = req.params;

  const evento = db.prepare('SELECT * FROM eventos WHERE id = ?').get(evento_id);
  if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });

  const escaneos = db.prepare(`
    SELECT es.timestamp, es.tipo_acceso, es.es_duplicado, es.sospechoso,
    qr.numero_flyer, qr.tipo_qr, u.nombre as rrpp_nombre, re.codigo_descuento
    FROM escaneos es
    JOIN qr_codes qr ON es.qr_id = qr.id
    JOIN usuarios u ON qr.rrpp_id = u.id
    JOIN rrpp_eventos re ON re.rrpp_id = u.id AND re.evento_id = qr.evento_id
    WHERE qr.evento_id = ?
    ORDER BY es.timestamp ASC
  `).all(evento_id);

  const fileName = `Escaneos_${evento.nombre.replace(/\s+/g, '_')}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

  const header = 'Timestamp,RRPP,Codigo_descuento,Flyer_num,Tipo_QR,Tipo_acceso,Duplicado,Sospechoso\n';
  const rows = escaneos.map(e =>
    `${e.timestamp},${e.rrpp_nombre},${e.codigo_descuento},${e.numero_flyer},${e.tipo_qr},${e.tipo_acceso},${e.es_duplicado},${e.sospechoso}`
  ).join('\n');

  res.send(header + rows);
};

module.exports = { generateEventReport, exportCSV };
