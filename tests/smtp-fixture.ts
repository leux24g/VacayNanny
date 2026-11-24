// Loopback-only SMTP sink for tests and synthetic UI review. Never forwards mail.
import { createServer } from 'node:net'
export async function smtpFixture() {
  const messages: Array<{ to: string; raw: string; code: string | null }> = []
  const server = createServer((socket) => {
    socket.write('220 localhost Test SMTP\r\n')
    let buffer = '',
      data = false,
      raw = '',
      recipients: string[] = []
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n'),
          line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        if (data) {
          if (line === '.') {
            for (const to of recipients)
              messages.push({
                to,
                raw,
                code: raw.match(/(?:\r?\n|>)\s*(\d{6})\s*(?:\r?\n|<)/)?.[1] || null,
              })
            data = false
            raw = ''
            recipients = []
            socket.write('250 2.0.0 Queued locally\r\n')
          } else raw += line + '\r\n'
        } else if (/^EHLO|^HELO/i.test(line))
          socket.write('250-localhost\r\n250 AUTH PLAIN\r\n')
        else if (/^AUTH /i.test(line)) socket.write('235 2.7.0 Authenticated\r\n')
        else if (/^RCPT TO:/i.test(line)) {
          recipients.push(line.match(/<([^>]+)>/)?.[1] || '')
          socket.write('250 OK\r\n')
        } else if (/^DATA/i.test(line)) {
          data = true
          socket.write('354 End with dot\r\n')
        } else if (/^QUIT/i.test(line)) {
          socket.end('221 Bye\r\n')
        } else socket.write('250 OK\r\n')
      }
    })
    socket.on('error', () => {})
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('SMTP test server unavailable')
  return {
    port: address.port,
    messages,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
