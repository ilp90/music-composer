import { expect, test } from '@playwright/test';
import { createAccount, PASSWORD, signUp, uniqueEmail } from './helpers';

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

test('"Continue with Google" starts the OAuth flow at the API, keeping the destination', async ({
  page,
}) => {
  await page.goto('/compose'); // redirected to /login, remembering /compose

  await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
    'href',
    '/api/auth/google/start?returnTo=%2Fcompose',
  );
});

test('a failed Google sign-in explains what happened', async ({ page }) => {
  await page.goto('/login?error=google_cancelled');

  await expect(page.getByRole('alert')).toHaveText('Google sign-in was cancelled.');
});
