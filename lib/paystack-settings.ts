export type PaystackEnvironment = 'uat' | 'prod'

/** Unprefixed credentials always mean test mode. Never fall back between modes. */
export function paystackSettings(
  env: Partial<NodeJS.ProcessEnv> = process.env,
  environment?: PaystackEnvironment,
) {
  const selected = environment || env.PAYSTACK_MODE ||
    (env.VERCEL_ENV === 'production' ? 'prod' : 'uat')
  if (selected !== 'uat' && selected !== 'prod')
    throw new Error('PAYSTACK_MODE must be uat or prod.')
  const production = selected === 'prod'
  const secretKey = (production ? env.PROD_PAYSTACK_SECRET_KEY : env.PAYSTACK_SECRET_KEY)?.trim()
  const webhookSecret = (production ? env.PROD_PAYSTACK_WEBHOOK_SECRET : env.PAYSTACK_WEBHOOK_SECRET)?.trim()
  const publicKey = (production ? env.PROD_PAYSTACK_PUBLIC_KEY : env.PAYSTACK_PUBLIC_KEY)?.trim()
  if (secretKey && !secretKey.startsWith(production ? 'sk_live_' : 'sk_test_'))
    throw new Error(`Configure the correct Paystack ${selected.toUpperCase()} secret key.`)
  if (publicKey && !publicKey.startsWith(production ? 'pk_live_' : 'pk_test_'))
    throw new Error(`Configure the correct Paystack ${selected.toUpperCase()} public key.`)
  if (webhookSecret && !webhookSecret.startsWith('whsec_'))
    throw new Error(`Configure the correct Paystack ${selected.toUpperCase()} webhook signing secret.`)
  return {
    environment: selected as PaystackEnvironment,
    domain: production ? 'live' : 'test',
    secretKey,
    webhookSecret,
    callbackPath: `/payments/return/${selected}`,
    webhookPath: `/api/payments/webhook/${selected}`,
  }
}
