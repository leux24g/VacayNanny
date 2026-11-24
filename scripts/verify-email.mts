import nextEnv from '@next/env'
import { smtpTransport } from '../lib/smtp'
nextEnv.loadEnvConfig(process.cwd())
const transport = smtpTransport()
try {
  await transport.verify()
  console.log('SMTP connection and authentication verified. No email was sent.')
} catch {
  console.error(
    'SMTP verification failed. Check the configured account, app password and network connection.',
  )
  process.exitCode = 1
} finally {
  transport.close()
}
