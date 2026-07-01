const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const generateId = () => uuidv4();

const hashIP = (ip) => {
  return crypto.createHash('sha256').update(ip + 'flyertrack_salt').digest('hex').substring(0, 16);
};

const detectAccessType = (req) => {
  const referer = req.headers.referer || req.headers.referrer || '';
  const userAgent = req.headers['user-agent'] || '';

  if (
    referer.includes('whatsapp') ||
    referer.includes('t.me') ||
    referer.includes('instagram') ||
    referer.includes('facebook') ||
    referer.includes('twitter') ||
    userAgent.includes('WhatsApp') ||
    userAgent.includes('Telegram')
  ) {
    return 'enlace';
  }
  return 'fisico';
};

const generateFingerprint = (req) => {
  const ua = req.headers['user-agent'] || '';
  const lang = req.headers['accept-language'] || '';
  const encoding = req.headers['accept-encoding'] || '';
  return crypto.createHash('sha256').update(ua + lang + encoding).digest('hex').substring(0, 32);
};

const formatDate = (date) => {
  return new Date(date).toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

module.exports = { generateId, hashIP, detectAccessType, generateFingerprint, formatDate };
