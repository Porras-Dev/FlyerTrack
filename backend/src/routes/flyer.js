const express = require('express');
const router = express.Router();
const multer = require('multer');
const { insertQRsIntoFlyer, generateDigitalFlyer } = require('../controllers/flyerController');
const { verifyToken, adminOnly } = require('../middleware/auth');

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten PNG, JPG o PDF'));
    }
  }
});

router.post('/insertar', verifyToken, adminOnly, upload.single('flyer'), insertQRsIntoFlyer);
router.post('/digital', verifyToken, adminOnly, upload.single('flyer'), generateDigitalFlyer);

module.exports = router;
