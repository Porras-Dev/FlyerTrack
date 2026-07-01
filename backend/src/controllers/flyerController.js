const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { db } = require('../config/database');
const { generateId } = require('../utils/helpers');

const insertQRsIntoFlyer = async (req, res) => {
  const { evento_id, rrpp_id, pos_x, pos_y, qr_size } = req.body;

  if (!evento_id || !rrpp_id || !req.file) {
    return res.status(400).json({ error: 'evento_id, rrpp_id y flyer son obligatorios' });
  }

  const posX = parseInt(pos_x) || 100;
  const posY = parseInt(pos_y) || 100;
  const qrSize = parseInt(qr_size) || 300;

  const qrs = db.prepare(`
    SELECT qr.*, u.nombre as rrpp_nombre, e.nombre as evento_nombre
    FROM qr_codes qr
    JOIN usuarios u ON qr.rrpp_id = u.id
    JOIN eventos e ON qr.evento_id = e.id
    WHERE qr.evento_id = ? AND qr.rrpp_id = ?
    ORDER BY qr.numero_flyer ASC
  `).all(evento_id, rrpp_id);

  if (qrs.length === 0) {
    return res.status(404).json({ error: 'No hay QRs generados para este RRPP en este evento' });
  }

  const rrpp = db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(rrpp_id);
  const evento = db.prepare('SELECT nombre FROM eventos WHERE id = ?').get(evento_id);

  const flyerBuffer = req.file.buffer;
  const flyerInfo = await sharp(flyerBuffer).metadata();

  const tempDir = path.join(__dirname, '../../temp', generateId());
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    const QRCode = require('qrcode');
    const rrppName = rrpp.nombre.replace(/\s+/g, '_');
    const eventName = evento.nombre.replace(/\s+/g, '_');

    for (const qr of qrs) {
      const url = `${process.env.BASE_URL}/qr/${qr.token}`;
      const qrBuffer = await QRCode.toBuffer(url, {
        errorCorrectionLevel: 'H',
        type: 'png',
        width: qrSize,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' }
      });

      const format = req.body.formato || 'png';
      let flyerWithQR;
      let fileName;

      if (format === 'pdf') {
        const { PDFDocument } = require('pdf-lib');
        const pngBuffer = await sharp(flyerBuffer)
          .composite([{ input: qrBuffer, left: posX, top: posY }])
          .png()
          .toBuffer();
        const pdfDoc = await PDFDocument.create();
        const meta = await sharp(flyerBuffer).metadata();
        const page = pdfDoc.addPage([meta.width, meta.height]);
        const pngImage = await pdfDoc.embedPng(pngBuffer);
        page.drawImage(pngImage, { x: 0, y: 0, width: meta.width, height: meta.height });
        flyerWithQR = Buffer.from(await pdfDoc.save());
        fileName = `${eventName}_${rrppName}_flyer${String(qr.numero_flyer).padStart(4, '0')}.pdf`;
      } else {
        flyerWithQR = await sharp(flyerBuffer)
          .composite([{ input: qrBuffer, left: posX, top: posY }])
          .png()
          .toBuffer();
        fileName = `${eventName}_${rrppName}_flyer${String(qr.numero_flyer).padStart(4, '0')}.png`;
      }

      fs.writeFileSync(path.join(tempDir, fileName), flyerWithQR);
    }

    const archiver = require('archiver');
    const zipName = `Flyers_${eventName}_${rrppName}.zip`;
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
      res.status(500).json({ error: 'Error insertando QRs en flyers' });
    }
  }
};

const generateDigitalFlyer = async (req, res) => {
  const { evento_id, rrpp_id } = req.body;

  if (!evento_id || !rrpp_id || !req.file) {
    return res.status(400).json({ error: 'evento_id, rrpp_id y flyer son obligatorios' });
  }

  const qrs = db.prepare(`
    SELECT qr.token, qr.numero_flyer
    FROM qr_codes qr
    WHERE qr.evento_id = ? AND qr.rrpp_id = ?
    ORDER BY qr.numero_flyer ASC
    LIMIT 1
  `).get(evento_id, rrpp_id);

  if (!qrs) {
    return res.status(404).json({ error: 'No hay QRs generados para este RRPP' });
  }

  const rrpp = db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(rrpp_id);
  const evento = db.prepare('SELECT nombre FROM eventos WHERE id = ?').get(evento_id);

  try {
    const QRCode = require('qrcode');
    const url = `${process.env.BASE_URL}/qr/${qrs.token}`;
    const qrBuffer = await QRCode.toBuffer(url, {
      errorCorrectionLevel: 'H',
      type: 'png',
      width: 300,
      margin: 1
    });

    const digitalFlyer = await sharp(req.file.buffer)
      .resize(1080, 1080, { fit: 'cover' })
      .composite([{
        input: qrBuffer,
        gravity: 'southeast'
      }])
      .png()
      .toBuffer();

    const rrppName = rrpp.nombre.replace(/\s+/g, '_');
    const eventName = evento.nombre.replace(/\s+/g, '_');

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="Digital_${eventName}_${rrppName}.png"`);
    res.send(digitalFlyer);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error generando flyer digital' });
  }
};

module.exports = { insertQRsIntoFlyer, generateDigitalFlyer };
