'use strict';

// Sends email through the shop's own email account (SMTP), as set up on the
// Settings page.
const nodemailer = require('nodemailer');

async function sendMail(settings, { to, subject, text, attachments = [] }) {
  const port = Number(settings.smtp_port) || 465;
  const address = settings.smtp_from || settings.business_email || settings.smtp_user;
  const transport = nodemailer.createTransport({
    host: settings.smtp_host,
    port,
    secure: port === 465, // other ports upgrade to an encrypted connection with STARTTLS
    auth: settings.smtp_user ? { user: settings.smtp_user, pass: settings.smtp_pass } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
  try {
    return await transport.sendMail({
      from: { name: settings.business_name || '', address },
      replyTo: settings.business_email || undefined,
      to,
      subject,
      text,
      attachments,
    });
  } finally {
    transport.close();
  }
}

module.exports = { sendMail };
