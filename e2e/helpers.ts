import { randomUUID } from 'node:crypto';
import { expect, type Browser, type Page } from '@playwright/test';

export const PASSWORD = 'violet-fifths-lantern';
export const uniqueEmail = () => `e2e-${randomUUID()}@example.com`;

export async function signUp(page: Page, email: string, displayName = 'Ada Lovelace') {
  await page.goto('/register');
  await page.getByLabel('Display name').fill(displayName);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
}

/** Registers in a separate browser context, so the test's own page starts signed out. */
export async function createAccount(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUp(page, email);
  await expect(page).toHaveURL('/compose');
  await context.close();
}
