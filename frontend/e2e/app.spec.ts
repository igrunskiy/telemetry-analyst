import { test, expect } from '@playwright/test'

test('login and load history plus car/track selections', async ({ page }) => {
  const accessToken = process.env.E2E_ACCESS_TOKEN

  if (accessToken) {
    await page.goto(`/callback?access_token=${accessToken}`)
  } else {
    await page.goto('/login')
    await page.getByRole('button', { name: /login with garage61/i }).click()
  }

  await page.waitForURL('**/app', { timeout: 120_000 })

  const carSelect = page.getByTestId('car-select')
  const trackSelect = page.getByTestId('track-select')

  await expect(carSelect).toBeVisible()
  await expect(trackSelect).toBeVisible()

  await expect
    .poll(() => carSelect.locator('option').count(), { timeout: 30_000 })
    .toBeGreaterThan(1)

  await expect
    .poll(() => trackSelect.locator('option').count(), { timeout: 30_000 })
    .toBeGreaterThan(1)

  const history = page.getByTestId('analysis-history')
  await expect(history).toBeVisible()

  const historyItems = history.getByTestId('analysis-history-item')
  const historyEmpty = history.getByTestId('analysis-history-empty')

  await expect
    .poll(async () => {
      const items = await historyItems.count()
      const emptyVisible = await historyEmpty.isVisible().catch(() => false)
      return items > 0 || emptyVisible
    })
    .toBeTruthy()
})
