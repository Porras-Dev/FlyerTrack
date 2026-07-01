const express = require('express');
const router = express.Router();
const { processScan, privacyPage, registerFingerprint, publicErrorPage, claimQR } = require('../controllers/landingController');

router.get('/bloqueado', (req, res) => {
  res.status(403).send(publicErrorPage('QR bloqueado', 'Este código QR ha sido bloqueado por actividad sospechosa. Contacta con tu RRPP.'));
});
router.post('/claim/:token', claimQR);
router.post('/fingerprint/:escaneo_id', registerFingerprint);
router.get('/:token', processScan);
module.exports = router;
