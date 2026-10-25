import { expect, test, type Page } from '@playwright/test';
import { signUp, uniqueEmail } from './helpers';

// Ring midpoints as fractions of the radius; mirrors RING_RADII in circleOfFifths.ts.
const MAJOR_MID = (0.62 + 1) / 2;
const MINOR_MID = (0.3 + 0.62) / 2;

/** Clicks the wedge at `degrees` clockwise from 12 o'clock, `fraction` of the chart radius out. */
async function tapChart(page: Page, degrees: number, fraction: number) {
  const stage = page.getByTestId('compose-stage');
  await expect(stage).toHaveAttribute('data-chart', /,/);
  const box = (await stage.boundingBox())!;
  // The stage publishes the chart geometry it draws: "cx,cy,radius" in stage pixels.
  const [cx, cy, radius] = (await stage.getAttribute('data-chart'))!.split(',').map(Number) as [
    number,
    number,
    number,
  ];
  const rad = (degrees * Math.PI) / 180;
  await page.mouse.click(
    box.x + cx + fraction * radius * Math.sin(rad),
    box.y + cy - fraction * radius * Math.cos(rad),
  );
}

test.beforeEach(async ({ page }) => {
  await signUp(page, uniqueEmail());
  await expect(page).toHaveURL('/compose');
});

test('Start shows the live camera with the circle of fifths, and tapping keys plays them', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Start' }).click();

  // Chromium's fake camera (see playwright.config.ts) streams a test pattern.
  const video = page.getByTestId('camera-preview');
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 2 && v.videoWidth > 0))
    .toBe(true);
  await expect(page.getByRole('img', { name: /Circle of fifths/ })).toBeVisible();

  await tapChart(page, 0, MAJOR_MID);
  await expect(page.getByTestId('last-played')).toHaveText('C major');

  await tapChart(page, 30, MAJOR_MID);
  await expect(page.getByTestId('last-played')).toHaveText('G major');

  await tapChart(page, 0, MINOR_MID);
  await expect(page.getByTestId('last-played')).toHaveText('A minor');

  await page.getByRole('radio', { name: 'chord' }).click();
  await tapChart(page, 330, MAJOR_MID);
  await expect(page.getByTestId('last-played')).toHaveText('F major chord');
});

test('the chart opacity is adjustable between 20% and 80%', async ({ page }) => {
  await page.getByRole('button', { name: 'Start' }).click();
  const slider = page.getByRole('slider', { name: 'Chart opacity' });

  await expect(slider).toHaveValue('40');
  await slider.fill('65');
  await expect(page.getByText('65%')).toBeVisible();
  await expect(slider).toHaveAttribute('min', '20');
  await expect(slider).toHaveAttribute('max', '80');
});

test('a blocked camera explains the problem and still lets you play by tapping', async ({
  page,
}) => {
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });

  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('alert')).toContainText('Camera access was blocked');

  await page.getByRole('button', { name: 'Play without camera' }).click();
  await expect(page.getByTestId('camera-preview')).toHaveCount(0);
  await tapChart(page, 0, MAJOR_MID);
  await expect(page.getByTestId('last-played')).toHaveText('C major');
});
