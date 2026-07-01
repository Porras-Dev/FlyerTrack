const fs = require('fs');
const path = require('path');
const { db } = require('../config/database');
const { backupAlert } = require('./alertas');

const exportHistory = (eventId = null) => {
  try {
    const historyDir = path.join(__dirname, '../../historico');
    fs.mkdirSync(historyDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);

    let eventos = eventId
      ? [db.prepare('SELECT * FROM eventos WHERE id = ?').get(eventId)]
      : db.prepare('SELECT * FROM eventos').all();

    for (const evento of eventos) {
      if (!evento) continue;

      const fileName = `${evento.nombre.replace(/\s+/g, '_')}_${timestamp}.json`;
      const filePath = path.join(historyDir, fileName);

      const rrpps = db.prepare('SELECT * FROM rrpp_eventos WHERE evento_id = ?').all(evento.id);
      const qrs = db.prepare('SELECT * FROM qr_codes WHERE evento_id = ?').all(evento.id);
      const escaneos = db.prepare(`
        SELECT es.* FROM escaneos es
        JOIN qr_codes qr ON es.qr_id = qr.id
        WHERE qr.evento_id = ?
      `).all(evento.id);
      const historico = db.prepare('SELECT * FROM historico_eventos WHERE evento_id = ?').all(evento.id);

      const data = { evento, rrpps, qrs, escaneos, historico, exportado_en: new Date().toISOString() };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`Historico exportado: ${fileName}`);
    }

    backupAlert(true, `Histórico exportado correctamente`);
    return true;

  } catch (error) {
    console.error('Error exportando histórico:', error);
    backupAlert(false, `Error: ${error.message}`);
    return false;
  }
};

const importHistory = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      console.error('Fichero no encontrado:', filePath);
      return false;
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const eventExists = db.prepare('SELECT id FROM eventos WHERE id = ?').get(data.evento.id);
    if (!eventExists) {
      db.prepare(`
        INSERT OR IGNORE INTO eventos (id, nombre, fecha, lugar, sala, url_monsterticket, estado, creado_en)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(data.evento.id, data.evento.nombre, data.evento.fecha, data.evento.lugar,
        data.evento.sala, data.evento.url_monsterticket, data.evento.estado, data.evento.creado_en);
    }

    for (const he of data.historico) {
      db.prepare(`
        INSERT OR IGNORE INTO historico_eventos
        (id, evento_id, rrpp_id, total_flyers, flyers_activados, total_escaneos,
        escaneos_fisicos, escaneos_enlace, escaneos_duplicados, escaneos_sospechosos, exportado_en)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(he.id, he.evento_id, he.rrpp_id, he.total_flyers, he.flyers_activados,
        he.total_escaneos, he.escaneos_fisicos, he.escaneos_enlace,
        he.escaneos_duplicados, he.escaneos_sospechosos, he.exportado_en);
    }

    console.log(`Histórico importado: ${data.evento.nombre}`);
    return true;

  } catch (error) {
    console.error('Error importando histórico:', error);
    return false;
  }
};

const automaticBackup = () => {
  const node_cron = require('node-cron');
  node_cron.schedule('0 * * * *', () => {
    console.log('Backup automático iniciado...');
    exportHistory();
  });
  console.log('Backup automático configurado: cada hora');
};

module.exports = { exportHistory, importHistory, automaticBackup };
