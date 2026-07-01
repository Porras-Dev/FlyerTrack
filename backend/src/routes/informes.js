const express = require('express');
const router = express.Router();
const { generateEventReport, exportCSV } = require('../controllers/informesController');
const { verifyToken, adminOrManagerOnly } = require('../middleware/auth');

router.get('/pdf/:evento_id', verifyToken, adminOrManagerOnly, generateEventReport);
router.get('/csv/:evento_id', verifyToken, adminOrManagerOnly, exportCSV);

module.exports = router;
