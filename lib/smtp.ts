import nodemailer from 'nodemailer'
import { emailSettings } from './email-settings'
export function smtpTransport() {
  const { smtp } = emailSettings()
  if (
    !smtp.user ||
    !smtp.password ||
    !Number.isInteger(smtp.port) ||
    smtp.port < 1 ||
    smtp.port > 65535
  )
    throw new Error('SMTP email delivery is not configured.')
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !['localhost', '127.0.0.1'].includes(smtp.host),
    auth: { user: smtp.user, pass: smtp.password },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true,
  })
}
