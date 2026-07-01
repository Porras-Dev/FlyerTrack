const express = require('express');
const router = express.Router();
const { listRRPPs, getRRPP, createRRPP, editRRPP, resetPassword, listGroups, createGroup, editGroup, deleteGroup, listSuspensions, liftSanction, deleteRRPP } = require('../controllers/rrppController');
const { verifyToken, adminOnly, adminOrManagerOnly } = require('../middleware/auth');

router.get('/', verifyToken, adminOrManagerOnly, listRRPPs);
router.get('/suspensiones', verifyToken, adminOnly, listSuspensions);
router.get('/grupos/lista', verifyToken, adminOrManagerOnly, listGroups);
router.get('/:id', verifyToken, adminOrManagerOnly, getRRPP);
router.post('/', verifyToken, adminOnly, createRRPP);
router.post('/grupos', verifyToken, adminOnly, createGroup);
router.post('/:id/levantar-sancion', verifyToken, adminOnly, liftSanction);
router.put('/:id', verifyToken, adminOnly, editRRPP);
router.put('/:id/password', verifyToken, adminOnly, resetPassword);
router.put('/grupos/:id', verifyToken, adminOnly, editGroup);
router.delete('/grupos/:id', verifyToken, adminOnly, deleteGroup);
router.delete('/:id', verifyToken, adminOnly, deleteRRPP);

module.exports = router;
