import { expect, type Page } from '@playwright/test'
export async function enterEmailCode(page: Page, email: string) {
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByRole('button', { name: 'Send sign-in code', exact: true }).click()
  await expect(page.getByLabel('Email verification code')).toBeVisible()
  const response = await page.request.get(
    `http://127.0.0.1:4748/__otp?email=${encodeURIComponent(email)}`,
  )
  const { code } = await response.json()
  expect(code).toMatch(/^\d{6}$/)
  await page.getByLabel('Email verification code').fill(code)
  await page.getByRole('button', { name: 'Verify and continue', exact: true }).click()
}
