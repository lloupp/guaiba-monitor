import { test, expect } from '@playwright/test';

test.describe('Guaiba Monitor App', () => {
  test('should load the page and display level indicator', async ({ page }) => {
    await page.goto('/');
    const levelIndicator = await page.locator('#level-indicator');
    await expect(levelIndicator).toBeVisible();
    const levelBadge = await page.locator('#level-badge');
    await expect(levelBadge).toHaveText(/./);
  });

  test('should render region cards', async ({ page }) => {
    await page.goto('/');
    const regionGrid = await page.locator('#region-grid');
    await expect(regionGrid).toBeVisible();
    const regionCards = await regionGrid.locator('.region-card');
    await expect(regionCards).toHaveCountGreaterThanOrEqual(1);
  });

  test('should display alert section', async ({ page }) => {
    await page.goto('/');
    const alertsSection = await page.locator('#alerts-section');
    await expect(alertsSection).toBeVisible();
  });
});
