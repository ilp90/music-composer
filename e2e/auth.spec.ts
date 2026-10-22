import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';

const PASSWORD = 'violet-fifths-lantern';
const uniqueEmail = () => `e2e-${randomUUID()}@example.com`;

async function signUp(page: Page, email: string, displayName = 'Ada Lovelace') {
  await page.goto('/register');
  await page.getByLabel('Display name').fill(displayName);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
}

/** Registers in a separate browser context, so the test's own page starts signed out. */
async function createAccount(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUp(page, email);
  await expect(page).toHaveURL('/compose');
  await context.close();
}

test('sign up lands on Compose, survives a reload, and signs out', async ({ page }) => {
  await signUp(page, uniqueEmail());

  await expect(page).toHaveURL('/compose');
  await expect(page.getByTestId('current-user')).toHaveText('Ada Lovelace');

  // The access token lives only in memory: a reload restores the session from the refresh cookie.
  await page.reload();
  await expect(page).toHaveURL('/compose');
  await expect(page.getByTestId('current-user')).toHaveText('Ada Lovelace');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/login');

  await page.goto('/compose');
  await expect(page).toHaveURL('/login');
});

test('a protected page sends visitors to sign in, then back where they were going', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail();
  await createAccount(browser, email);

  await page.goto('/compose');
  await expect(page).toHaveURL('/login');

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL('/compose');
});

test('wrong password shows a generic error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(uniqueEmail());
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('alert')).toHaveText('Invalid email or password');
  await expect(page).toHaveURL('/login');
});

test('registration shows field errors from the client and the server', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail();
  await createAccount(browser, email);

  await page.goto('/register');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Enter a display name')).toBeVisible();
  await expect(page.getByText('Enter a valid email')).toBeVisible();

  await signUp(page, email);
  await expect(page.getByText('An account with this email already exists')).toBeVisible();
  await expect(page).toHaveURL('/register');
});
