const express = require('express');
const router = express.Router();
const { login, refreshToken, logout, profile, changePassword } = require('../controllers/authController');
const { verifyToken, verifyRefreshToken } = require('../middleware/auth');

router.post('/login', login);
router.post('/refresh', verifyRefreshToken, refreshToken);
router.post('/logout', logout);
router.get('/perfil', verifyToken, profile);
router.put('/password', verifyToken, changePassword);

module.exports = router;
