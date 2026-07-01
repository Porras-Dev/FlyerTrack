const nodemailer = require('nodemailer');

let telegramBot = null;
let telegramChatId = null;

const initAlerts = () => {
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      const { Telegraf } = require('telegraf');
      telegramBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
      telegramChatId = process.env.TELEGRAM_CHAT_ID;
      console.log('Telegram configurado correctamente');
    } catch (e) {
      console.log('Telegram no configurado:', e.message);
    }
  }
};

const sendTelegram = async (message) => {
  if (!telegramBot || !telegramChatId) return;
  try {
    await telegramBot.telegram.sendMessage(telegramChatId, message, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('Error enviando Telegram:', e.message);
  }
};

const sendEmail = async (subject, body) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    await transporter.sendMail({
      from: `FlyerTrack <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: subject,
      html: body
    });
  } catch (e) {
    console.error('Error enviando email:', e.message);
  }
};

const fraudAlert = async ({ rrppName, eventName, token, scans, minutes }) => {
  const message = `🚨 <b>Alerta de fraude detectada</b>\n\n<b>RRPP:</b> ${rrppName}\n<b>Evento:</b> ${eventName}\n<b>QR:</b> ${token.substring(0, 8)}...\n<b>Escaneos:</b> ${scans} en menos de ${minutes} minutos\n\n⏰ ${new Date().toLocaleString('es-ES')}`;

  const emailBody = `
    <h2 style="color:#E24B4A">🚨 Alerta de fraude — FlyerTrack</h2>
    <p><strong>RRPP:</strong> ${rrppName}</p>
    <p><strong>Evento:</strong> ${eventName}</p>
    <p><strong>QR:</strong> ${token.substring(0, 8)}...</p>
    <p><strong>Escaneos sospechosos:</strong> ${scans} en menos de ${minutes} minutos</p>
    <p><strong>Hora:</strong> ${new Date().toLocaleString('es-ES')}</p>
    <hr>
    <p style="color:#999;font-size:12px">FlyerTrack — Sistema de control de RRPPs</p>
  `;

  await Promise.all([
    sendTelegram(message),
    sendEmail('🚨 FlyerTrack — Alerta de fraude detectada', emailBody)
  ]);
};

const backupAlert = async (success, details = '') => {
  const emoji = success ? '✅' : '❌';
  const status = success ? 'completado' : 'fallido';
  const message = `${emoji} <b>Backup ${status}</b>\n${details}\n⏰ ${new Date().toLocaleString('es-ES')}`;
  await sendTelegram(message);
};

module.exports = { initAlerts, fraudAlert, backupAlert };
