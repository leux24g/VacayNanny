import { test, expect } from '@playwright/test'
import { enterEmailCode } from './auth'
test('sign-in verifies the email code, rejects a wrong code, and resends with a cooldown', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('family@example.test')
  await page.getByLabel('Password', { exact: true }).fill('incorrect-password')
  await page.getByRole('button', { name: 'Send sign-in code', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'email or password is incorrect' }),
  ).toBeVisible()
  await expect(page.getByLabel('Email verification code')).toHaveCount(0)
  expect(
    (await page.context().cookies()).some((c) => c.name.includes('auth-token')),
  ).toBe(false)
  await page.getByLabel('Password', { exact: true }).fill('local-review')
  await page.getByRole('button', { name: 'Send sign-in code', exact: true }).click()
  await expect(page.getByLabel('Email verification code')).toBeVisible()
  await expect(page.getByRole('button', { name: /Resend in/ })).toBeDisabled()
  const { code } = await (
    await page.request.get('http://127.0.0.1:4748/__otp?email=family@example.test')
  ).json()
  await page
    .getByLabel('Email verification code')
    .fill(code === '000000' ? '999999' : '000000')
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'incorrect' })).toBeVisible()
  await page.getByLabel('Email verification code').fill(code)
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await expect(page).toHaveURL('/account')
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible()
})
test('signup preserves the selected nanny route after email verification on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/signup')
  await page.getByLabel('Full name').fill('Nanny Test')
  await page.getByLabel('Email', { exact: true }).fill('nanny@example.test')
  await page.getByLabel('New password', { exact: true }).fill('local-review')
  await page.getByRole('radio', { name: /Nanny/ }).check()
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByLabel('Email verification code')).toBeVisible()
  const { code } = await (
    await page.request.get('http://127.0.0.1:4748/__otp?email=nanny@example.test')
  ).json()
  await page.getByLabel('Email verification code').fill(code)
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true)
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await expect(page).toHaveURL('/nanny')
})
test('nanny requests family completion code and must enter it; error and confirmation stay usable on mobile', async ({
  page,
}) => {
  await page.goto('/login')
  await enterEmailCode(page, 'nanny@example.test')
  await expect(page).toHaveURL('/nanny')
  const endpoint = '**/api/booking/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/completion'
  let attempts = 0
  await page.route(endpoint, (route) => {
    if (route.request().method() === 'POST')
      return route.fulfill({
        json: { challengeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', resendAfter: 60 },
      })
    const body = route.request().postDataJSON()
    expect(body.challengeId).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    attempts++
    return attempts === 1
      ? route.fulfill({
          status: 400,
          json: { error: 'This code is incorrect or expired.' },
        })
      : route.fulfill({ json: { success: true, completed: false } })
  })
  await page.setViewportSize({ width: 320, height: 740 })
  await page.getByLabel('Actual hours worked').fill('8')
  await page.getByLabel('Work completed and handover').fill('Completed the agreed childcare and family handover.')
  await page.getByRole('checkbox', {name:/I confirm that this report is accurate/}).check()
  await page.getByRole('button', { name: 'Send completion code to family' }).click()
  await expect(page.getByText(/Code sent to the family/)).toBeVisible()
  await page.getByLabel('Family completion code').fill('123456')
  await page.getByRole('button', { name: 'Confirm work complete' }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'incorrect or expired' }),
  ).toBeVisible()
  await page.getByLabel('Family completion code').fill('654321')
  await page.getByRole('button', { name: 'Confirm work complete' }).click()
  await expect(
    page.getByText('Your work is confirmed. Waiting for the other nanny confirmations.'),
  ).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true)
})

test('a password-only cookie cannot open protected pages before the email code is verified', async ({
  page,
}) => {
  const response = await page.request.post(
    'http://127.0.0.1:4748/auth/v1/token?grant_type=password',
    { data: { email: 'family@example.test', password: 'local-review' } },
  )
  const session = await response.json()
  await page
    .context()
    .addCookies([
      {
        name: 'sb-127-auth-token',
        value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'),
        domain: 'localhost',
        path: '/',
      },
    ])
  await page.goto('/account')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: 'Your trips' })).toHaveCount(0)
  const mutation = await page.request.patch(
    '/api/booking/11111111-1111-4111-8111-111111111111',
    { data: { action: 'confirm' } },
  )
  expect([401, 403]).toContain(mutation.status())
})

test('password recovery verifies an emailed code before returning to sign-in without authenticating', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/reset-password')
  await expect(page).toHaveURL('/forgot-password')
  await page.getByLabel('Email', { exact: true }).fill('family@example.test')
  await page.getByLabel('New password', { exact: true }).fill('Recovery-password-123!')
  await page.getByRole('button', { name: 'Send reset code', exact: true }).click()
  await expect(page.getByLabel('Email verification code')).toBeVisible()
  const { code } = await (
    await page.request.get('http://127.0.0.1:4748/__otp?email=family@example.test')
  ).json()
  await page.getByLabel('Email verification code').fill(code)
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await expect(page).toHaveURL('/login?password=reset')
  await expect(page.getByText('Your password has been updated. Sign in with your new password.')).toBeVisible()
  expect((await page.context().cookies()).some((cookie) => cookie.name.includes('auth-token'))).toBe(false)
  await page.goto('/account')
  await expect(page).toHaveURL(/\/login/)
})
