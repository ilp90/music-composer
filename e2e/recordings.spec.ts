import { expect, test, type Page } from '@playwright/test';
import { signUp, uniqueEmail } from './helpers';

test.describe.configure({ timeout: 60_000 });

async function startComposing(page: Page) {
  await signUp(page, uniqueEmail());
  await expect(page).toHaveURL('/compose');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect
    .poll(() =>
      page.getByTestId('camera-preview').evaluate((v: HTMLVideoElement) => v.videoWidth > 0),
    )
    .toBe(true);
}

async function tapCenterOfTopKey(page: Page) {
  const stage = page.getByTestId('compose-stage');
  const box = (await stage.boundingBox())!;
  const [cx, cy, r] = (await stage.getAttribute('data-chart'))!.split(',').map(Number) as [
    number,
    number,
    number,
  ];
  await page.mouse.click(box.x + cx, box.y + cy - 0.81 * r);
}

async function recordFor(page: Page, ms: number) {
  await page.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByTestId('recording-timer')).toContainText('/ 5:00');
  await tapCenterOfTopKey(page); // a note in the recording
  await page.waitForTimeout(ms);
  await page.getByRole('button', { name: 'Stop' }).click();
}

test('record → upload → play back from My recordings → delete', async ({ page }) => {
  await startComposing(page);
  await recordFor(page, 2500);
  await expect(page.getByTestId('recording-notice')).toContainText('Saved — uploading');

  await page.getByRole('link', { name: 'My recordings' }).first().click();
  const card = page.getByTestId('recording-card');
  await expect(card).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByTestId('local-recording-card')).toHaveCount(0);
  // Duration is wall-clock from Record to Stop: at least the 2.5 s we waited.
  const [, minutes, seconds] = /(\d+):(\d\d) ·/.exec((await card.textContent())!)!;
  expect(Number(minutes) * 60 + Number(seconds)).toBeGreaterThanOrEqual(2);

  // The player gets a signed S3 URL that serves the uploaded video.
  const video = card.locator('video');
  await expect(video).toHaveAttribute('src', /X-Amz-Signature=/);
  const src = (await video.getAttribute('src'))!;
  const served = await page.request.get(src);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toMatch(/^video\/(webm|mp4)/);
  expect((await served.body()).byteLength).toBeGreaterThan(10_000);

  page.once('dialog', (dialog) => void dialog.accept());
  await card.getByRole('button', { name: 'Delete' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText('No recordings yet.')).toBeVisible();
  expect((await page.request.get(src)).status()).toBe(404);
});

test('the R key starts and stops recording', async ({ page }) => {
  await startComposing(page);

  await page.keyboard.press('r');
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.keyboard.press('r');

  await expect(page.getByRole('button', { name: 'Record' })).toBeVisible();
  await expect(page.getByTestId('recording-notice')).toContainText('Saved');
});

test('a recording made offline waits on the device and uploads when the connection returns', async ({
  page,
  context,
}) => {
  await startComposing(page);
  await page.getByRole('button', { name: 'Record' }).click();
  await page.waitForTimeout(1500);

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByTestId('recording-notice')).toContainText('Saved');

  await page.getByRole('link', { name: 'My recordings' }).first().click();
  const pending = page.getByTestId('local-recording-card');
  await expect(pending).toHaveCount(1);
  await expect(pending.getByTestId('upload-status')).toHaveText(
    'Waiting for a connection to upload',
  );

  await context.setOffline(false); // fires `online`: the queue resumes
  await expect(page.getByTestId('recording-card')).toHaveCount(1, { timeout: 20_000 });
  await expect(pending).toHaveCount(0);
});
