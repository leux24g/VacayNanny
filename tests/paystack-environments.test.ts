import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { paystackSettings } from '../lib/paystack-settings'
import { POST as webhook } from '../app/api/payments/webhook/[environment]/route'
import { checkSetup } from '../lib/setup-checks'

const credentials = {
  PAYSTACK_SECRET_KEY: 'sk_test_fixture',
  PAYSTACK_PUBLIC_KEY: 'pk_test_fixture',
  PAYSTACK_WEBHOOK_SECRET: 'whsec_test_fixture',
  PROD_PAYSTACK_SECRET_KEY: 'sk_live_fixture',
  PROD_PAYSTACK_PUBLIC_KEY: 'pk_live_fixture',
  PROD_PAYSTACK_WEBHOOK_SECRET: 'whsec_live_fixture',
}
const previous = { ...process.env }
after(() => { process.env = previous })

test('UAT and PROD select their own credentials and URLs without falling back', () => {
  const uat = paystackSettings(credentials)
  const prod = paystackSettings({ ...credentials, VERCEL_ENV: 'production' })
  assert.equal(uat.secretKey, credentials.PAYSTACK_SECRET_KEY)
  assert.equal(uat.webhookSecret, credentials.PAYSTACK_WEBHOOK_SECRET)
  assert.equal(uat.callbackPath, '/payments/return/uat')
  assert.equal(uat.webhookPath, '/api/payments/webhook/uat')
  assert.equal(prod.secretKey, credentials.PROD_PAYSTACK_SECRET_KEY)
  assert.equal(prod.webhookSecret, credentials.PROD_PAYSTACK_WEBHOOK_SECRET)
  assert.equal(prod.callbackPath, '/payments/return/prod')
  assert.equal(prod.webhookPath, '/api/payments/webhook/prod')
  assert.equal(paystackSettings({ ...credentials, PAYSTACK_MODE: 'uat', VERCEL_ENV: 'production' }).domain, 'test')
  assert.equal(paystackSettings({ ...credentials, PAYSTACK_MODE: 'prod', PROD_PAYSTACK_SECRET_KEY: '' }).secretKey, '')
  assert.equal(paystackSettings({ ...credentials, PAYSTACK_MODE: 'uat', PAYSTACK_SECRET_KEY: '' }).secretKey, '')
})

test('incorrect key prefixes and unknown modes fail before any provider call', () => {
  assert.throws(() => paystackSettings({ PAYSTACK_MODE: 'invalid' }))
  assert.throws(() => paystackSettings({ PAYSTACK_SECRET_KEY: 'sk_live_wrong' }))
  assert.throws(() => paystackSettings({ PAYSTACK_MODE: 'prod', PROD_PAYSTACK_SECRET_KEY: 'sk_test_wrong' }))
  assert.throws(() => paystackSettings({ PAYSTACK_PUBLIC_KEY: 'pk_live_wrong' }))
})

test('setup checks production using only PROD_ credentials and detects a UAT selection', () => {
  const env = { ...credentials, PAYSTACK_MODE: 'prod', NEXT_PUBLIC_SITE_URL: 'https://www.vacaynanny.net' }
  const checks = checkSetup(env, 'production')
  for (const name of ['Paystack', 'Paystack webhook', 'Payment environment'])
    assert.equal(checks.find((check) => check.name === name)?.status, 'ready')
  assert.equal(checkSetup({ ...env, PAYSTACK_MODE: 'uat' }, 'production').find((check) => check.name === 'Payment environment')?.status, 'invalid')
  assert.equal(checkSetup({ ...env, PROD_PAYSTACK_SECRET_KEY: '' }, 'production').find((check) => check.name === 'Paystack')?.status, 'pending')
})

test('each webhook route rejects the other environment and the other signing secret', async () => {
  const raw = JSON.stringify({ event: 'sandbox.ping' })
  const timestamp = Math.floor(Date.now() / 1000)
  const request = (environment: string, secret: string) => new NextRequest(`http://localhost/api/payments/webhook/${environment}`, {
    method: 'POST', body: raw,
    headers: { 'Paystack-Signature': `t=${timestamp},v1=whk_fixture:${createHmac('sha512', secret).update(`${timestamp}.${raw}`).digest('hex')}` },
  })
  for (const environment of ['uat', 'prod'] as const) {
    Object.assign(process.env, credentials, { PAYSTACK_MODE: environment })
    const other = environment === 'uat' ? 'prod' : 'uat'
    const secret = environment === 'uat' ? credentials.PAYSTACK_WEBHOOK_SECRET : credentials.PROD_PAYSTACK_WEBHOOK_SECRET
    const wrong = environment === 'uat' ? credentials.PROD_PAYSTACK_WEBHOOK_SECRET : credentials.PAYSTACK_WEBHOOK_SECRET
    assert.equal((await webhook(request(environment, secret), { params: Promise.resolve({ environment }) })).status, 200)
    assert.equal((await webhook(request(environment, wrong), { params: Promise.resolve({ environment }) })).status, 401)
    assert.equal((await webhook(request(other, wrong), { params: Promise.resolve({ environment: other }) })).status, 404)
  }
})
