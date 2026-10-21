import { test, expect } from '@playwright/test';

test('script approval and saved storyboards occupy separate keyboard-accessible screens', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  for (const [label, value] of Object.entries({ 'Full name': 'Tab Reviewer', Email: 'separate-tabs@example.com', Username: 'separate-tabs', Password: 'test-password-123' })) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  await page.getByRole('button', { name: '+ New project', exact: true }).click();
  for (const [label, value] of Object.entries({ 'Project name': 'Production screens', Niche: 'DIY', Platform: 'Facebook', 'Target audience': 'Homeowners', 'Content style': 'Practical tips' })) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Ideas', exact: true })).toHaveAttribute('aria-selected', 'true');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole('tab', { name: 'Scripts', exact: true }).click();
    const scripts = page.getByRole('tabpanel', { name: 'Scripts', exact: true });
    await expect(scripts).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Review and approve scripts', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Generated storyboards', exact: true })).not.toBeVisible();
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(scripts).toBeFocused();
    await page.screenshot({ path: `test-results/script-screen-${width}.png`, fullPage: true });
    await page.getByRole('tab', { name: 'Storyboards', exact: true }).click();
    const storyboards = page.getByRole('tabpanel', { name: 'Storyboards', exact: true });
    await expect(storyboards).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Generated storyboards', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Review and approve scripts', exact: true })).not.toBeVisible();
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(storyboards).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: `test-results/storyboard-screen-${width}.png`, fullPage: true });
    await page.getByRole('tab', { name: 'Storyboards', exact: true }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'Scripts', exact: true })).toBeFocused();
    await expect(scripts).toBeVisible();
    await expect(storyboards).not.toBeVisible();
  }
  expect(errors).toEqual([]);
});
