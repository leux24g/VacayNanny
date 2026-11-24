import { test, expect } from '@playwright/test'
import { enterEmailCode } from './auth'
test('sign-in verifies the email code, rejects a wrong code, and resends with a cooldown', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('family@example.test')
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
