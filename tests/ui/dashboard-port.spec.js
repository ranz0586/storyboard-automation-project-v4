import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openProject(page, username) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  for (const [label, value] of Object.entries({ 'Full name': 'Port Tester', Email: username + '@example.com', Username: username, Password: 'test-password-123' })) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('button', { name: '+ New project', exact: true }).click();
  for (const [label, value] of Object.entries({ 'Project name': 'Port ' + username, Niche: 'Science', Platform: 'YouTube', 'Target audience': 'Adults', 'Content style': 'Edutainment' })) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Ideas', exact: true })).toBeVisible();
}

async function showPackage(page, fields) {
  await page.route('**/api/projects/*/storyboards?*', route => route.fulfill({ json: { storyboards: [{ script: { id: 'display-script', fields: { title: 'Saved production package', status: 'Story Generated' } }, storyboard: { id: 'display-storyboard', fields } }], nextOffset: null } }));
  await page.getByRole('tab', { name: 'Storyboards', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh storyboards', exact: true }).click();
  await page.locator('#storyboards > details > summary').click();
}

test('workspace keeps unsaved settings and idea selections across tabs, then resets on project change', async ({ page }) => {
  await openProject(page, 'port-state');
  await page.locator('.manual-generation > summary').click();
  await page.getByLabel('Idea count', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Generate ideas', exact: true }).click();
  await page.locator('#ideas input').first().check();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Time', { exact: true }).fill('13:47');
  await page.getByRole('tab', { name: 'Ideas', exact: true }).click();
  await expect(page.locator('#ideas input').first()).toBeChecked();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Time', { exact: true })).toHaveValue('13:47');
  await page.getByRole('tab', { name: 'Settings', exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Activity', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Ideas', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '+ New project', exact: true }).click();
  for (const [label, value] of Object.entries({ 'Project name': 'Second port project', Niche: 'Science', Platform: 'YouTube', 'Target audience': 'Adults', 'Content style': 'Edutainment' })) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Ideas', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#ideas input')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Time', { exact: true })).toHaveValue('09:00');
});

test('all formats show complete saved prompts and export safely without requesting future feature APIs', async ({ page, context }) => {
  const errors = [], unsupported = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\/storyboard-audit|\/production-export/.test(new URL(request.url()).pathname)) unsupported.push(request.url()); });
  await openProject(page, 'port-packages');
  const image = index => 'A complete scene image '.repeat(250) + 'IMAGE_END_' + index;
  const frames = Array.from({ length: 8 }, (_, index) => ({ frame: index + 1, timestamp: `${index * 3}s - ${(index + 1) * 3}s`, narration: 'Narration ' + (index + 1), image_prompt: image(index + 1), video_prompt: 'Animate scene ' + (index + 1) }));
  const output = { master_assets: { character: '<img src=x onerror=alert(1)>' },
    structure1: frames,
    structure2: [{ panel: 1, time_range: '0s - 24s', panel_prompt: 'All scenes together', video_prompt: 'Ordered panel motion', keyframes: frames.map(frame => frame.frame) }],
    structure3: Array.from({ length: 4 }, (_, index) => ({ panel: index + 1, start_seconds: index * 6, end_seconds: (index + 1) * 6, panel_prompt: 'Panel ' + (index + 1), video_prompt: 'Panel motion ' + (index + 1), keyframes: frames.slice(index * 2, index * 2 + 2).map(frame => ({ frame: frame.frame, timestamp: frame.timestamp, caption_narration: frame.narration, image_prompt: frame.image_prompt })) })) };
  const fields = { storyboard_text: JSON.stringify(output), unknown_legacy_field: { preserve: true } };
  await showPackage(page, fields);
  const s3 = page.getByRole('region', { name: 'Structure 3', exact: true });
  await expect(s3.getByRole('button', { name: 'Copy Prompt A / image', exact: true })).toHaveCount(8);
  await expect(s3.getByRole('button', { name: 'Copy Prompt B / panel animation', exact: true })).toHaveCount(4);
  await expect(page.getByText('Scene references: 1, 2, 3, 4, 5, 6, 7, 8', { exact: true })).toBeVisible();
  await expect(page.locator('#storyboards img')).toHaveCount(0);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await s3.getByRole('button', { name: 'Copy Prompt A / image', exact: true }).last().click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(image(8));
  const [jsonDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export saved JSON', exact: true }).click()]);
  expect(JSON.parse(await readFile(await jsonDownload.path(), 'utf8'))).toEqual(fields);
  const [sheets] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export printable sheets', exact: true }).click()]);
  const html = await readFile(await sheets.path(), 'utf8');
  expect(html).toContain('Structure 3 / Panel 4');
  expect(html).toContain(image(8));
  expect(html).toContain('&lt;img');
  expect(html).not.toMatch(/<script\b|<img\b/i);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await s3.getByRole('heading', { name: 'Panel 4', exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: `test-results/dashboard-port-package-${width}.png` });
  }
  expect(unsupported).toEqual([]);
  expect(errors).toEqual([]);
});

test('legacy text summaries and Structure 1 panel_prompt survive cards, copy and draft sheets', async ({ page, context }) => {
  await openProject(page, 'port-legacy');
  const frames = Array.from({ length: 10 }, (_, index) => ({ frame: index + 1, panel_prompt: 'Legacy image ' + (index + 1), video_prompt: 'Legacy animation ' + (index + 1), timestamp: index * 3 + 's' }));
  await showPackage(page, { storyboard_text: 'Saved plain-text summary', structure1_json: JSON.stringify(frames) });
  await expect(page.getByText('Saved plain-text summary', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy Prompt A / image', exact: true })).toHaveCount(10);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy Prompt A / image', exact: true }).last().click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Legacy image 10');
  const [sheets] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export printable sheets', exact: true }).click()]);
  const html = await readFile(await sheets.path(), 'utf8');
  expect(html).toContain('Legacy image 10');
  expect(html).toContain('Legacy animation 10');
});
