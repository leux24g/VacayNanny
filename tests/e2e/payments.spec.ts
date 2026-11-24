import { test, expect } from '@playwright/test'

test('guest checkout recovers from provider errors, rejects unsafe URLs and preserves the private return link', async ({ page }) => {
  const id = '11111111-1111-4111-8111-111111111111'
  const token = 'a'.repeat(64)
  const trackingPath = `/booking/${id}?token=${token}`
  let outcome: 'error' | 'unsafe' | 'success' = 'error'
  await page.route('**/api/payments/initialize', async (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`)
    expect(route.request().postDataJSON()).toEqual({ bookingId: id })
    await route.fulfill(outcome === 'error'
      ? { status: 503, json: { error: 'Checkout is temporarily unavailable. Please try again.' } }
      : { json: { authorizationUrl: outcome === 'unsafe' ? 'https://example.test/unsafe' : 'https://checkout.paystack.com/browser-fixture' } })
  })
  await page.route('https://checkout.paystack.com/browser-fixture', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Sandbox checkout fixture</h1>' }),
  )
  await page.goto(trackingPath)
  const pay = page.getByRole('button', { name: 'Pay KES 4,400', exact: true })
  await pay.click()
  await expect(page.getByRole('region', { name: 'Booking payment' }).getByRole('alert')).toContainText('temporarily unavailable')
  await expect(pay).toBeEnabled()
  outcome = 'unsafe'
  await pay.click()
  await expect(page.getByRole('region', { name: 'Booking payment' }).getByRole('alert')).toContainText('Invalid checkout address')
  await expect(page).toHaveURL(trackingPath)
  outcome = 'success'
  await pay.click()
  await expect(page).toHaveURL('https://checkout.paystack.com/browser-fixture')
  await page.goto('/payments/return/uat')
  await expect(page.getByRole('heading', { name: 'Let’s check your payment.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Return to my booking' })).toHaveAttribute('href', trackingPath)
  await page.getByRole('link', { name: 'Return to my booking' }).click()
  await expect(page).toHaveURL(trackingPath)
})

test('payment return ignores an invalid reference and an unsafe stored return address', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('vacaynanny:booking-return', 'https://example.test/unsafe')
  })
  await page.goto('/payments/return/uat?reference=untrusted')
  await expect(page.getByRole('heading', { name: 'Let’s check your payment.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Return to my booking' })).toHaveAttribute('href', '/account')
  await expect(page.getByText('Your payment has been securely recorded with VacayNanny.')).toHaveCount(0)
})

test('UAT serves its own callback and rejects PROD payment endpoints', async ({ page }) => {
  await page.goto('/payments/return/uat')
  await expect(page.getByRole('heading', { name: 'Let’s check your payment.' })).toBeVisible()
  await page.goto('/payments/return/prod')
  await expect(page.getByRole('heading', { name: "We couldn't find that page." })).toBeVisible()
  const prodWebhook = await page.request.post('/api/payments/webhook/prod', { data: { event: 'sandbox.ping' } })
  expect(prodWebhook.status()).toBe(404)
  const unknownWebhook = await page.request.post('/api/payments/webhook/unknown', { data: { event: 'sandbox.ping' } })
  expect(unknownWebhook.status()).toBe(404)
})
