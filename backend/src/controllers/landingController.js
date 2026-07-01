const { db } = require('../config/database');
const { generateId, hashIP, detectAccessType, generateFingerprint } = require('../utils/helpers');
const { fraudAlert } = require('../utils/alertas');

const processScan = (req, res) => {
  const { token } = req.params;

  const qr = db.prepare(`
    SELECT qr.*, e.estado, e.nombre as evento_nombre
    FROM qr_codes qr
    JOIN eventos e ON qr.evento_id = e.id
    WHERE qr.token = ?
  `).get(token);

  if (!qr) return res.status(404).send(errorPage('QR no válido', 'Este código QR no existe o ha sido desactivado.'));
  if (qr.bloqueado) return res.status(403).send(errorPage('QR bloqueado', 'Este código QR ha sido bloqueado por actividad sospechosa. Contacta con tu RRPP.'));
  if (qr.estado !== 'activo') return res.status(410).send(errorPage('Evento finalizado', 'Este evento ya ha terminado. ¡Hasta la próxima!'));

  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${qr.evento_nombre}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0a;display:flex;align-items:center;justify-content:center;min-height:100vh}</style>
</head><body>
<script>
(async()=>{
  try{
    const canvas=document.createElement('canvas');
    const ctx=canvas.getContext('2d');
    ctx.textBaseline='top';ctx.font='14px Arial';
    ctx.fillText('FlyerTrack\u{1F389}',2,2);
    const ch=canvas.toDataURL().slice(-50);
    const fp=[
      navigator.userAgent,
      navigator.language,
      screen.width+'x'+screen.height,
      screen.colorDepth,
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency||0,
      navigator.deviceMemory||0,
      ch
    ].join('|');
    let hash=0;
    for(let i=0;i<fp.length;i++){hash=((hash<<5)-hash)+fp.charCodeAt(i);hash|=0;}
    const fingerprint=Math.abs(hash).toString(16).padStart(8,'0');
    const res=await fetch('/qr/claim/${token}',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({fingerprint})
    });
    const data=await res.json();
    if(data.html){
      document.open();document.write(data.html);document.close();
    } else if(data.error){
      document.open();document.write(data.error);document.close();
    }
  }catch(e){
    window.location.reload();
  }
})();
</script>
</body></html>`);
};

const claimQR = (req, res) => {
  const { token } = req.params;
  const { fingerprint } = req.body;

  if (!fingerprint) return res.json({ error: errorPage('Error', 'No se pudo verificar el dispositivo.') });

  const qr = db.prepare(`
    SELECT qr.*, re.codigo_descuento,
    e.nombre as evento_nombre, e.fecha, e.lugar, e.sala,
    e.url_monsterticket, e.estado, e.entradas_restantes, e.oferta_expira,
    e.umbral_fraude_escaneos, e.umbral_fraude_minutos,
    u.nombre as rrpp_nombre
    FROM qr_codes qr
    JOIN eventos e ON qr.evento_id = e.id
    JOIN rrpp_eventos re ON re.evento_id = e.id AND re.rrpp_id = qr.rrpp_id
    JOIN usuarios u ON qr.rrpp_id = u.id
    WHERE qr.token = ?
  `).get(token);

  if (!qr) return res.json({ error: errorPage('QR no válido', 'Este código QR no existe.') });
  if (qr.bloqueado) return res.json({ error: errorPage('QR bloqueado', 'Este código QR ha sido bloqueado por actividad sospechosa.') });
  if (qr.estado !== 'activo') return res.json({ error: errorPage('Evento finalizado', 'Este evento ya ha terminado.') });

  // Check if this device is blocked for this event
  // EXCEPTION: if this QR is its own (device_fp matches), it can always be opened
  const isOwnQR = qr.device_fp && qr.device_fp === fingerprint;

  if (!isOwnQR) {
    const blockedDevice = db.prepare(`
      SELECT id FROM dispositivos_bloqueados
      WHERE fingerprint = ? AND evento_id = ?
    `).get(fingerprint, qr.evento_id);

    if (blockedDevice) {
      return res.json({ error: errorPage('Acceso denegado', 'Tu dispositivo ha sido bloqueado por intentar usar múltiples códigos QR en este evento.') });
    }

    // Check if the QR was already claimed by another fingerprint
    if (qr.device_fp && qr.device_fp !== fingerprint) {
      return res.json({ error: errorPage('QR ya utilizado', 'Este código QR ya fue escaneado por otra persona. Cada flyer es personal e intransferible.') });
    }

    // Check if this fingerprint already has another QR in this event
    const existingOwnQR = db.prepare(`
      SELECT id FROM qr_codes
      WHERE device_fp = ? AND evento_id = ? AND id != ?
      LIMIT 1
    `).get(fingerprint, qr.evento_id, qr.id);

    if (existingOwnQR) {
      // Block the device for this event
      db.prepare('INSERT INTO dispositivos_bloqueados (id, fingerprint, evento_id) VALUES (?, ?, ?)').run(generateId(), fingerprint, qr.evento_id);
      fraudAlert({
        rrppName: qr.rrpp_nombre,
        eventName: qr.evento_nombre,
        token: qr.token,
        scans: 0,
        minutes: 0
      });
      return res.json({ error: errorPage('Acceso denegado', 'Tu dispositivo ha sido bloqueado por intentar usar múltiples códigos QR en este evento.') });
    }

    // Claim the QR
    db.prepare('UPDATE qr_codes SET device_fp = ? WHERE id = ?').run(fingerprint, qr.id);
  }

  const ipHash = hashIP(req.ip || req.connection.remoteAddress || 'unknown');
  const accessType = detectAccessType(req);

  const nowMs = Date.now();
  const windowMs = nowMs - qr.umbral_fraude_minutos * 60 * 1000;

  const previousScans = db.prepare(`
    SELECT COUNT(*) as total FROM escaneos
    WHERE qr_id = ? AND datetime(timestamp) > datetime(?, 'unixepoch')
    AND (motivo_sospecha IS NULL OR motivo_sospecha = 'reutilizacion')
  `).get(qr.id, Math.floor(windowMs / 1000));

  const isDuplicate = db.prepare(`
    SELECT id FROM escaneos WHERE qr_id = ? AND ip_hash = ? LIMIT 1
  `).get(qr.id, ipHash) ? 1 : 0;

  const isFinalSuspicious = previousScans.total >= qr.umbral_fraude_escaneos - 1 ? 1 : 0;
  const suspicionReason = isFinalSuspicious ? 'reutilizacion' : null;

  const scanId = generateId();
  const nowISO = new Date().toISOString().replace('T', ' ').substring(0, 19);
  db.prepare(`
    INSERT INTO escaneos (id, qr_id, timestamp, ip_hash, user_agent, tipo_acceso, es_duplicado, sospechoso, motivo_sospecha, device_fingerprint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(scanId, qr.id, nowISO, ipHash, req.headers['user-agent'] || '', accessType, isDuplicate, isFinalSuspicious, suspicionReason, fingerprint);

  if (isFinalSuspicious) {
    db.prepare('UPDATE qr_codes SET bloqueado = 1 WHERE id = ?').run(qr.id);
    saveMLData(scanId, qr, req, accessType, isDuplicate, isFinalSuspicious);
    fraudAlert({
      rrppName: qr.rrpp_nombre,
      eventName: qr.evento_nombre,
      token: qr.token,
      scans: previousScans.total,
      minutes: qr.umbral_fraude_minutos
    });
    return res.json({ error: errorPage('QR bloqueado', 'Este código QR ha sido bloqueado por actividad sospechosa.') });
  }

  const offerExpires = qr.oferta_expira ? new Date(qr.oferta_expira).getTime() : null;
  const now = Date.now();
  const offerActive = offerExpires && offerExpires > now;
  const secondsRemaining = offerActive ? Math.floor((offerExpires - now) / 1000) : 0;

  return res.json({ html: landingPage({
    sala: qr.sala,
    eventoNombre: qr.evento_nombre,
    fecha: qr.fecha,
    lugar: qr.lugar,
    codigoDescuento: qr.codigo_descuento,
    urlMonsterticket: qr.url_monsterticket,
    entradasRestantes: qr.entradas_restantes,
    ofertaActiva: offerActive,
    segundosRestantes: secondsRemaining,
    tipoAcceso: accessType
  })});
};

const saveMLData = (scanId, qr, req, accessType, isDuplicate, isSuspicious) => {
  try {
    const features = JSON.stringify({
      tipo_acceso: accessType,
      es_duplicado: isDuplicate,
      user_agent: req.headers['user-agent'] || '',
      hora_dia: new Date().getHours(),
      dia_semana: new Date().getDay()
    });
    db.prepare(`
      INSERT INTO ml_datos (id, escaneo_id, features, etiqueta)
      VALUES (?, ?, ?, ?)
    `).run(generateId(), scanId, features, isSuspicious ? 'sospechoso' : 'valido');
  } catch (e) {
    console.error('Error guardando datos ML:', e);
  }
};

const roomColors = {
  velvet: { primario: '#D4537E', secundario: '#1a0a10', texto: '#f8e8ef' },
  lemon: { primario: '#EFB827', secundario: '#0f0a00', texto: '#fff8e8' },
  zrrcus: { primario: '#E8732A', secundario: '#0f0800', texto: '#fff3e8' }
};

const landingPage = ({ sala, eventoNombre, fecha, lugar, codigoDescuento, urlMonsterticket, entradasRestantes, ofertaActiva, segundosRestantes, tipoAcceso }) => {
  const colors = roomColors[sala] || roomColors.velvet;
  const formattedDate = new Date(fecha).toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${eventoNombre}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: ${colors.secundario}; color: ${colors.texto}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }
  .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 36px 28px; max-width: 420px; width: 100%; text-align: center; }
  .sala-badge { display: inline-block; background: ${colors.primario}; color: white; font-size: 12px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; padding: 6px 16px; border-radius: 20px; margin-bottom: 20px; }
  h1 { font-size: 26px; font-weight: 700; margin-bottom: 8px; line-height: 1.2; }
  .info { font-size: 14px; opacity: 0.7; margin-bottom: 6px; }
  .divider { border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 24px 0; }
  .codigo-label { font-size: 12px; text-transform: uppercase; letter-spacing: 2px; opacity: 0.6; margin-bottom: 8px; }
  .codigo { font-size: 36px; font-weight: 800; color: ${colors.primario}; letter-spacing: 4px; margin-bottom: 8px; }
  .codigo-sub { font-size: 12px; opacity: 0.5; margin-bottom: 24px; }
  ${entradasRestantes ? `.entradas { background: rgba(255,50,50,0.15); border: 1px solid rgba(255,50,50,0.3); border-radius: 10px; padding: 10px; margin-bottom: 20px; font-size: 13px; color: #ff8888; }` : ''}
  ${ofertaActiva ? `.timer { background: rgba(255,200,0,0.1); border: 1px solid rgba(255,200,0,0.3); border-radius: 10px; padding: 12px; margin-bottom: 20px; } .timer-label { font-size: 11px; opacity: 0.6; margin-bottom: 4px; } .timer-display { font-size: 22px; font-weight: 700; color: #ffcc00; font-variant-numeric: tabular-nums; }` : ''}
  .btn { display: block; background: ${colors.primario}; color: white; text-decoration: none; padding: 16px; border-radius: 12px; font-size: 16px; font-weight: 700; letter-spacing: 1px; transition: opacity 0.2s; }
  .btn:hover { opacity: 0.9; }
  .footer { margin-top: 24px; font-size: 11px; opacity: 0.3; }
  .gdpr { margin-top: 16px; font-size: 10px; opacity: 0.3; line-height: 1.5; }
  a.gdpr-link { color: inherit; }
</style>
</head>
<body>
<div class="card">
  <div class="sala-badge">${sala.toUpperCase()}</div>
  <h1>${eventoNombre}</h1>
  <p class="info">${formattedDate}</p>
  <p class="info">${lugar}</p>
  <hr class="divider">
  <p class="codigo-label">Tu código de descuento</p>
  <p class="codigo">${codigoDescuento}</p>
  <p class="codigo-sub">Introdúcelo al comprar tu entrada</p>
  ${entradasRestantes ? `<div class="entradas">Solo quedan <strong>${entradasRestantes} entradas</strong> disponibles</div>` : ''}
  ${ofertaActiva ? `<div class="timer"><div class="timer-label">Oferta anticipada termina en</div><div class="timer-display" id="timer">--:--:--</div></div>` : ''}
  <a href="${urlMonsterticket}" class="btn" target="_blank">COMPRAR ENTRADA</a>
  <p class="gdpr">Al acceder a esta página aceptas nuestra <a href="/privacidad" class="gdpr-link">política de privacidad</a>. Solo registramos datos técnicos anónimos.</p>
</div>
<p class="footer">Powered by FlyerTrack</p>
${ofertaActiva ? `<script>
  let s = ${segundosRestantes};
  const t = document.getElementById('timer');
  const tick = () => {
    if (s <= 0) { t.textContent = 'OFERTA EXPIRADA'; return; }
    const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60), ss = s%60;
    if(d > 0) {
      t.textContent = d + 'd ' + String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(ss).padStart(2,'0');
    } else {
      t.textContent = [h,m,ss].map(x=>String(x).padStart(2,'0')).join(':');
    }
    s--; setTimeout(tick, 1000);
  };
  tick();
</script>` : ''}
</body>
</html>`;
};

const errorPage = (title, message) => `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0a0a0a; color:#fff; font-family:-apple-system,sans-serif; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
  .card { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:20px; padding:40px 28px; max-width:380px; width:100%; text-align:center; }
  h1 { font-size:22px; margin-bottom:12px; }
  p { opacity:0.6; font-size:14px; line-height:1.6; }
</style>
</head>
<body>
<div class="card">
  <h1>${title}</h1>
  <p>${message}</p>
</div>
</body>
</html>`;

const privacyPage = (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Política de privacidad</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0a0a0a; color:#ccc; font-family:-apple-system,sans-serif; max-width:600px; margin:0 auto; padding:40px 20px; }
  h1 { color:#fff; margin-bottom:24px; font-size:22px; }
  h2 { color:#fff; margin:20px 0 8px; font-size:16px; }
  p { font-size:14px; line-height:1.7; margin-bottom:12px; }
</style>
</head>
<body>
<h1>Política de privacidad</h1>
<h2>Datos que registramos</h2>
<p>Al escanear un código QR registramos únicamente: fecha y hora del acceso, tipo de dispositivo (móvil/escritorio) y una versión anonimizada de tu dirección IP que no permite identificarte.</p>
<h2>Finalidad</h2>
<p>Estos datos se usan exclusivamente para medir la efectividad de campañas de distribución de flyers. No se usan para publicidad ni se comparten con terceros.</p>
<h2>Conservación</h2>
<p>Los datos se conservan durante 90 días tras la celebración del evento y se eliminan automáticamente.</p>
<h2>Tus derechos</h2>
<p>Puedes ejercer tus derechos de acceso, rectificación y supresión contactando con el organizador del evento.</p>
</body>
</html>`);
};

const registerFingerprint = (req, res) => {
  res.json({ ok: true });
};

const publicErrorPage = (title, message) => errorPage(title, message);

module.exports = { processScan, claimQR, privacyPage, registerFingerprint, publicErrorPage };
