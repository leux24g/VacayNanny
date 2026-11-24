import { emailSettings } from './email-settings'
import { paystackSettings } from './paystack-settings'

export type SetupTarget = 'local' | 'staging' | 'production'
export type SetupCheck = {
  name: string
  status: 'ready' | 'pending' | 'invalid' | 'deferred'
  detail: string
}

function configured(value: string | undefined) {
  return Boolean(value?.trim() && !/YOUR_|REPLACE_|CHANGEME|^example/i.test(value))
}

export function checkSetup(
  env: Partial<NodeJS.ProcessEnv>,
  target: SetupTarget = 'local',
): SetupCheck[] {
  const checks: SetupCheck[] = []
  const add = (name: string, status: SetupCheck['status'], detail: string) =>
    checks.push({ name, status, detail })
  try {
    const url = new URL(env.NEXT_PUBLIC_SITE_URL || '')
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    const valid =
      (target === 'local' || !local) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/' &&
      (url.protocol === 'https:' ||
        (target === 'local' && local && url.protocol === 'http:'))
    add(
      'Site URL',
      valid ? 'ready' : 'invalid',
      valid
        ? `Configured for ${target}.`
        : 'Use an origin URL with HTTPS outside local development.',
    )
  } catch {
    add('Site URL', 'pending', 'Set NEXT_PUBLIC_SITE_URL for this environment.')
  }

  const cron = env.CRON_SECRET || ''
  add(
    'Scheduled job secret',
    configured(cron) && cron.length >= 32 && !/[\r\n\s]/.test(cron) ? 'ready' : 'pending',
    configured(cron) && cron.length >= 32 && !/[\r\n\s]/.test(cron)
      ? 'A private cron secret is configured.'
      : 'Set a random CRON_SECRET of at least 32 characters.',
  )

  const email = emailSettings(env)
  if (
    env.EMAIL_DELIVERY_MODE &&
    !['disabled', 'send'].includes(env.EMAIL_DELIVERY_MODE)
  ) {
    add('Email delivery', 'invalid', 'EMAIL_DELIVERY_MODE must be disabled or send.')
  } else if (email.mode === 'disabled') {
    add(
      'Email delivery',
      target === 'production' ? 'pending' : 'ready',
      target === 'production'
        ? 'Enable email delivery after verifying the sending domain.'
        : 'Sending is disabled; local previews remain available.',
    )
  } else {
    const ready =
      email.provider === 'smtp'
        ? configured(email.smtp.user) && configured(email.smtp.password)
        : configured(email.apiKey) && email.apiKey?.startsWith('re_')
    add(
      'Email delivery',
      ready ? 'ready' : 'pending',
      ready
        ? `${email.provider.toUpperCase()} credentials are configured; delivery still needs verification.`
        : `Configure ${email.provider.toUpperCase()} credentials before enabling delivery.`,
    )
  }

  const from = email.from.match(/<([^<>]+)>$/)?.[1] || email.from
  const validAddress = (value: string) =>
    /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value) && !/[\r\n]/.test(value)
  add(
    'Email addresses',
    validAddress(from) && validAddress(email.replyTo) && !/[\r\n]/.test(email.from)
      ? 'ready'
      : 'invalid',
    validAddress(from) && validAddress(email.replyTo) && !/[\r\n]/.test(email.from)
      ? 'Sender and reply-to addresses have valid formats.'
      : 'Check RESEND_FROM_EMAIL and RESEND_REPLY_TO_EMAIL.',
  )

  const productionPayments = target === 'production'
  const key = productionPayments ? env.PROD_PAYSTACK_SECRET_KEY : env.PAYSTACK_SECRET_KEY
  const expected = target === 'production' ? 'sk_live_' : 'sk_test_'
  add(
    'Paystack',
    !configured(key) ? 'pending' : key!.startsWith(expected) ? 'ready' : 'invalid',
    !configured(key)
      ? target === 'production'
        ? 'A live merchant key is still needed before taking payments.'
        : 'A merchant test key is still needed for payment sandbox checks.'
      : key!.startsWith(expected)
        ? `A ${productionPayments ? 'PROD_ live' : 'UAT test'} key is configured; no payment was attempted.`
        : `Use a ${expected} key in ${productionPayments ? 'PROD_PAYSTACK_SECRET_KEY' : 'PAYSTACK_SECRET_KEY'} for ${target}.`,
  )
  const webhookSecret = productionPayments ? env.PROD_PAYSTACK_WEBHOOK_SECRET : env.PAYSTACK_WEBHOOK_SECRET
  add(
    'Paystack webhook',
    configured(webhookSecret) &&
      webhookSecret?.startsWith('whsec_')
      ? 'ready'
      : 'pending',
    configured(webhookSecret) &&
      webhookSecret?.startsWith('whsec_')
      ? 'Timestamped signature verification is configured.'
      : 'Configure the webhook signing secret in Paystack when available; legacy signature validation remains supported.',
  )
  try {
    const settings = paystackSettings(env)
    const expectedEnvironment = productionPayments ? 'prod' : 'uat'
    add('Payment environment', settings.environment === expectedEnvironment ? 'ready' : 'invalid',
      settings.environment === expectedEnvironment
        ? `${settings.environment.toUpperCase()} selected; callback ${settings.callbackPath}, webhook ${settings.webhookPath}.`
        : `Set PAYSTACK_MODE=${expectedEnvironment} for ${target}.`)
  } catch {
    add('Payment environment', 'invalid', 'Check PAYSTACK_MODE and the key prefixes for its selected environment.')
  }
  add(
    'Agreement PDF',
    configured(env.NANNY_AGREEMENT_STORAGE_PATH) ? 'ready' : 'pending',
    configured(env.NANNY_AGREEMENT_STORAGE_PATH)
      ? 'The document path is set; verify the final PDF in private storage before delivery.'
      : 'The final blank agreement PDF and its private storage path are still needed.',
  )
  add(
    'Supabase',
    'pending',
    'Run setup:check with --database to check the selected schema. This configuration-only run made no database calls.',
  )
  return checks
}
