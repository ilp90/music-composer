import { expect, test } from '@playwright/test';

test('home page reaches the API through the /api proxy', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Music Composer' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('API: healthy');
});
