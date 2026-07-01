const QRCode = require('qrcode');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { db } = require('../config/database');
const { generateId } = require('../utils/helpers');

const generateQRToken = () => {
  return require('crypto').randomBytes(16).toString('hex');
};

const generateQRBuffer = async (url, withLogo = false, logoPath = null) => {
  const qrBuffer = await QRCode.toBuffer(url, {
    errorCorrectionLevel: 'H',
    type: 'png',
    width: 400,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' }
  });

  if (!withLogo || !logoPath || !fs.existsSync(logoPath)) {
    return qrBuffer;
  }

  const logoSize = 80;
  const logoBuffer = await sharp(logoPath)
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();

  return await sharp(qrBuffer)
    .composite([{ input: logoBuffer, gravity: 'centre' }])
    .png()
    .toBuffer();
};

const generateQRsBatch = async (req, res) => {
  const { evento_id, rrpp_id, cantidad, tipo_qr } = req.body;

  if (!evento_id || !rrpp_id || !cantidad) {
    return res.status(400).json({ error: 'evento_id, rrpp_id y cantidad son obligatorios' });
  }

  if (cantidad > 1000) {
    return res.status(400).json({ error: 'Maximo 1000 QRs por lote' });
  }

  const evento = db.prepare('SELECT * FROM eventos WHERE id = ?').get(evento_id);
  if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });

  const rrpp = db.prepare('SELECT * FROM usuarios WHERE id = ? AND rol = ?').get(rrpp_id, 'rrpp');
  if (!rrpp) return res.status(404).json({ error: 'RRPP no encontrado' });

  const assignment = db.prepare('SELECT * FROM rrpp_eventos WHERE evento_id = ? AND rrpp_id = ?').get(evento_id, rrpp_id);
  if (!assignment) return res.status(400).json({ error: 'El RRPP no esta asignado a este evento' });

  const qrType = tipo_qr === 'con_logo' ? 'con_logo' : 'estandar';
  const logoPath = path.join(__dirname, '../../assets/logos', `${evento.sala}.png`);

  const tempDir = path.join(__dirname, '../../temp', generateId());
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const rrppName = rrpp.nombre.replace(/\s+/g, '_');
    const eventName = evento.nombre.replace(/\s+/g, '_');

    const batchId = generateId();
    for (let i = 1; i <= cantidad; i++) {
      const token = generateQRToken();
      const id = generateId();
      const url = `${process.env.BASE_URL}/qr/${token}`;

      db.prepare(`
        INSERT INTO qr_codes (id, token, rrpp_id, evento_id, numero_flyer, tipo_qr, lote_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, token, rrpp_id, evento_id, i, qrType, batchId);

      const qrBuffer = await generateQRBuffer(url, qrType === 'con_logo', logoPath);
      const fileName = `${eventName}_${rrppName}_flyer${String(i).padStart(4, '0')}.png`;
      const filePath = path.join(tempDir, fileName);
      fs.writeFileSync(filePath, qrBuffer);
    }

    const zipName = `QRs_${eventName}_${rrppName}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = new archiver.ZipArchive({ zlib: { level: 9 } });
    archive.pipe(res);
    archive.glob('*', { cwd: tempDir });

    archive.on('end', () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    archive.on('error', (err) => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      throw err;
    });

    await archive.finalize();

  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error generando QRs' });
    }
  }
};

const listQRs = (req, res) => {
  const { evento_id, rrpp_id } = req.query;
  let query = `
    SELECT qr.lote_id, qr.rrpp_id, qr.evento_id, qr.tipo_qr,
    MIN(qr.creado_en) as creado_en,
    COUNT(qr.id) as cantidad,
    u.nombre as rrpp_nombre, e.nombre as evento_nombre
    FROM qr_codes qr
    JOIN usuarios u ON qr.rrpp_id = u.id
    JOIN eventos e ON qr.evento_id = e.id
    WHERE 1=1
  `;
  const params = [];

  if (evento_id) { query += ' AND qr.evento_id = ?'; params.push(evento_id); }
  if (rrpp_id) { query += ' AND qr.rrpp_id = ?'; params.push(rrpp_id); }

  query += ' GROUP BY qr.lote_id ORDER BY creado_en DESC LIMIT 50';

  const qrs = db.prepare(query).all(...params);
  res.json(qrs);
};

const deleteRRPPQRs = (req, res) => {
  const { lote_id } = req.params;
  db.prepare('DELETE FROM escaneos WHERE qr_id IN (SELECT id FROM qr_codes WHERE lote_id = ?)').run(lote_id);
  db.prepare('DELETE FROM qr_codes WHERE lote_id = ?').run(lote_id);
  res.json({ mensaje: 'Lote eliminado correctamente' });
};

const listBlocked = (req, res) => {
  const blocked = db.prepare(`
    SELECT qr.id, qr.token, qr.numero_flyer, qr.creado_en,
    u.nombre as rrpp_nombre, e.nombre as evento_nombre,
    COUNT(es.id) as total_escaneos,
    COUNT(CASE WHEN es.sospechoso = 1 THEN 1 END) as escaneos_sospechosos,
    MAX(es.motivo_sospecha) as motivo
    FROM qr_codes qr
    JOIN usuarios u ON qr.rrpp_id = u.id
    JOIN eventos e ON qr.evento_id = e.id
    LEFT JOIN escaneos es ON es.qr_id = qr.id
    WHERE qr.bloqueado = 1
    GROUP BY qr.id
    ORDER BY qr.creado_en DESC
  `).all();
  res.json(blocked);
};

const unblockQR = (req, res) => {
  const { id } = req.params;
  db.prepare('UPDATE qr_codes SET bloqueado = 0 WHERE id = ?').run(id);
  res.json({ mensaje: 'QR desbloqueado correctamente' });
};

module.exports = { generateQRsBatch, listQRs, deleteRRPPQRs, listBlocked, unblockQR };
