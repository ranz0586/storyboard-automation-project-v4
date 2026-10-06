import { test, expect } from '@playwright/test';

async function register(page, name, url = '/') {
  await page.goto(url);
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Full name', { exact: true }).fill('Dashboard Tester');
  await page.getByLabel('Email', { exact: true }).fill(`${name}@example.com`);
  await page.getByLabel('Username', { exact: true }).fill(name);
  await page.getByLabel('Password', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
}
async function createProject(page, name) {
  await page.getByRole('button', { name: '+ New project', exact: true }).click();
  for (const [label, value] of Object.entries({ 'Project name': name, Niche: 'Science', Platform: 'YouTube', 'Target audience': 'Adults', 'Content style': 'Edutainment' })) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true }).last()).toBeVisible();
}
const state = async request => (await request.get('/__test/state')).json();
const refresh = page => page.getByRole('button', { name: 'Refresh project', exact: true }).click();
const stat = (page, label) => page.locator('.stat').filter({ has: page.getByText(label, { exact: true }) }).locator('b');

test('complete dashboard lifecycle uses existing generation and persistence paths', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await register(page, 'workflow-user');
  await createProject(page, 'Workflow project');
  const projectId = (await state(request)).projects.find(project => project.fields.channel_page_name === 'Workflow project').id;
  await page.getByLabel('Idea count', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Generate ideas', exact: true }).click();
  await expect(page.locator('#ideas input[type=checkbox]')).toHaveCount(4);
  await expect(stat(page, 'Ideas')).toHaveText('4');

  // Failed selected generation is visible and retry uses the real worker.
  await request.post('/__test/fail-script');
  await page.locator('#ideas input[type=checkbox]').first().check();
  await page.getByRole('button', { name: 'Generate selected', exact: true }).click();
  await expect(page.getByText('Simulated provider outage', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Retry failures', exact: true }).click();
  await expect.poll(async () => (await state(request)).scripts.length).toBe(1);
  await refresh(page);
  await expect(page.locator('#ideas input[type=checkbox]')).toHaveCount(3);
  await page.getByLabel('Script count', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Recover drafts', exact: true }).click();
  await expect.poll(async () => (await state(request)).scripts.length).toBe(2);
  await refresh(page);
  await expect(page.getByText('SCRIPTS · RECOVERY', { exact: true })).toBeVisible();

  await page.getByLabel('Status', { exact: true }).selectOption('true');
  await page.getByLabel('Day', { exact: true }).selectOption('1');
  await page.getByLabel('Time', { exact: true }).fill('09:00');
  await page.getByLabel('Scripts per run', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Save schedule', exact: true }).click();
  await expect(page.getByText('Schedule saved', { exact: true })).toBeVisible();
  const scheduled = await (await request.post('/__test/scheduler')).json();
  expect(scheduled.runs).toHaveLength(1);
  await expect.poll(async () => (await state(request)).scripts.length).toBe(3);
  await refresh(page);
  await expect(page.getByText('SCRIPTS · SCHEDULED', { exact: true })).toBeVisible();
  await expect(stat(page, 'Scripts')).toHaveText('3');
  await page.screenshot({ path: 'test-results/project-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/project-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 720 });

  // Cursor pagination, approval and downstream storyboard persistence.
  await expect(page.locator('#scripts details')).toHaveCount(2);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('#scripts details')).toHaveCount(1);
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await page.locator('#scripts summary').first().click();
  await page.getByRole('button', { name: 'Approve for storyboard', exact: true }).first().click();
  await expect(stat(page, 'Approved')).toHaveText('1');
  const storyboard = await (await request.post(`/__test/storyboard/${projectId}`)).json();
  expect(storyboard.generated).toBe(1);
  await refresh(page);
  await expect(stat(page, 'Storyboards')).toHaveText('1');
  await expect(page.getByText('STORYBOARD · STORYBOARD_POLL', { exact: true })).toBeVisible();
  await expect(page.locator('#scripts summary').first()).toContainText('Story Generated');

  const recovery = await (await request.post(`/__test/recovery/${projectId}`)).json();
  expect(recovery.recovered).toBe(1);
  await refresh(page);
  await expect(stat(page, 'Scripts')).toHaveText('4');
  await expect(page.getByText('RECOVERY · OPERATOR', { exact: true })).toBeVisible();
  await expect(page.locator('#ideas input[type=checkbox]')).toHaveCount(0);
  const persisted = await state(request);
  expect(new Set(persisted.scripts.map(script => script.fields.video_id)).size).toBe(4);
  expect(persisted.alerts.some(alert => alert.type === 'error')).toBeTruthy();
  expect(persisted.alerts.some(alert => alert.type === 'success')).toBeTruthy();

  await page.getByLabel('Project status', { exact: true }).selectOption('Inactive');
  await page.getByRole('button', { name: 'Save status', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generate ideas', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('false');
  await page.getByLabel('Project status', { exact: true }).selectOption('Active');
  await page.getByRole('button', { name: 'Save status', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generate ideas', exact: true })).toBeEnabled();

  await createProject(page, 'Empty project');
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('false');
  await expect(stat(page, 'Scripts')).toHaveText('0');
  await expect(page.locator('#runs')).toHaveText('No activity for this project.');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Username', { exact: true }).fill('workflow-user');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.locator('#authError')).not.toBeEmpty();
  await page.getByLabel('Password', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Projects' }).getByRole('button')).toHaveCount(2);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('project switching rejects stale responses and expired sessions clear private views', async ({ page, request }) => {
  await register(page, 'isolation-user');
  await createProject(page, 'Slow project');
  await createProject(page, 'Fast project');
  const slowId = (await state(request)).projects.find(project => project.fields.channel_page_name === 'Slow project').id;
  await page.route(`**/api/projects/${slowId}`, async route => {
    const response = await route.fetch();
    await new Promise(resolve => setTimeout(resolve, 800));
    await route.fulfill({ response }).catch(() => {});
  });
  const nav = page.getByRole('navigation', { name: 'Projects' });
  await nav.getByRole('button', { name: 'Slow project', exact: true }).click();
  await nav.getByRole('button', { name: 'Fast project', exact: true }).click();
  await expect(page.locator('#projectDetail h3').first()).toHaveText('Fast project');
  await page.waitForTimeout(1000);
  await expect(page.locator('#projectDetail h3').first()).toHaveText('Fast project');
  await page.route('**/api/script-runs?*', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Please log in' }) }));
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.locator('#projectDetail')).toHaveCount(0);
  await expect(page.getByText('Fast project', { exact: true })).toHaveCount(0);
});

test('Vite development proxy preserves cookies and protected API writes', async ({ page }) => {
  await register(page, 'dev-user', 'http://127.0.0.1:5175/');
  await createProject(page, 'Development project');
  await expect(stat(page, 'Ideas')).toHaveText('0');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Projects' }).getByRole('button', { name: 'Development project', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('read errors can be retried and React renders record text safely', async ({ page }) => {
  await register(page, 'error-user');
  await createProject(page, '<img src=x onerror=alert(1)>');
  await expect(page.locator('#projectDetail img')).toHaveCount(0);
  let fail = true;
  await page.route('**/api/projects/*/scripts?*', async route => {
    if (fail) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Scripts temporarily unavailable' }) });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Refresh scripts', exact: true }).click();
  await expect(page.locator('#scripts')).toContainText('Scripts temporarily unavailable');
  fail = false;
  await page.getByRole('button', { name: 'Refresh scripts', exact: true }).click();
  await expect(page.locator('#scripts')).toContainText('No scripts for this project yet.');
});

test('interrupted script runs resume before, during and between items without repeating successes', async ({ page, request }) => {
  await register(page, 'interruption-user');
  for (const phase of ['before', 'mid', 'between']) {
    await createProject(page, `Interrupted ${phase}`);
    const project = (await state(request)).projects.find(row => row.fields.channel_page_name === `Interrupted ${phase}`);
    await page.getByLabel('Idea count', { exact: true }).fill('2');
    await page.getByRole('button', { name: 'Generate ideas', exact: true }).click();
    await expect(page.locator('#ideas input[type=checkbox]')).toHaveCount(2);
    if (phase !== 'before') {
      await page.locator('#ideas input[type=checkbox]').first().check();
      await page.getByRole('button', { name: 'Generate selected', exact: true }).click();
      await expect(page.locator('#ideas input[type=checkbox]')).toHaveCount(1);
    }
    const { run } = await (await request.post(`/__test/interrupted/${project.id}`, { data: { phase } })).json();
    await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume interrupted run' })).toBeVisible();
    if (phase === 'mid') await expect(page.getByText(`Interrupted idea: ${run.interruptedItem}`)).toBeVisible();
    await page.getByRole('button', { name: 'Resume interrupted run' }).click();
    await expect(page.getByRole('button', { name: 'Resume interrupted run' })).toHaveCount(0);
    await expect.poll(async () => (await state(request)).scripts.filter(row => row.fields.Projects === project.fields.project_id).length).toBe(2);
    const current = await state(request);
    const original = current.runs.find(row => row.id === run.id);
    expect(original.recoveredByRunId).toBeTruthy();
    expect(current.runs.find(row => row.id === original.recoveredByRunId).requestedCount).toBe(phase === 'before' ? 2 : 1);
  }
});

test('project and idea pages reach the fifty-first item and preserve selections across pages', async ({ page, request }) => {
  await register(page, 'pagination-user');
  await request.post('/__test/seed-pagination', { data: { username: 'pagination-user' } });
  await page.reload();
  const navigation = page.getByRole('navigation', { name: 'Projects' });
  await expect(navigation.getByRole('button')).toHaveCount(50);
  await page.getByRole('button', { name: 'Next projects', exact: true }).click();
  await expect(navigation.getByRole('button')).toHaveCount(1);
  await navigation.getByRole('button', { name: 'Paged project 51', exact: true }).click();
  await expect(page.locator('#ideas input[type=checkbox]')).toHaveCount(50);
  await page.locator('#ideas input[type=checkbox]').first().check();
  await page.getByRole('button', { name: 'Next ideas', exact: true }).click();
  await expect(page.locator('#ideas input[type=checkbox]')).toHaveCount(1);
  await expect(page.locator('#ideas')).toContainText('Paged idea 051');
  await expect(page.getByText('1 selected across pages (maximum 50)')).toBeVisible();
  await page.locator('#ideas input[type=checkbox]').first().check();
  await page.getByRole('button', { name: 'Previous ideas', exact: true }).click();
  await expect(page.locator('#ideas input[type=checkbox]').first()).toBeChecked();
  await expect(page.getByText('2 selected across pages (maximum 50)')).toBeVisible();
  await page.getByRole('button', { name: 'Generate selected', exact: true }).click();
  await expect.poll(async () => (await state(request)).scripts.filter(row => row.fields.title.startsWith('Script Paged idea')).length).toBe(2);
  await expect(page.getByText('0 selected across pages (maximum 50)')).toBeVisible();
  await page.getByRole('button', { name: 'Previous projects', exact: true }).click();
  await expect(navigation.getByRole('button')).toHaveCount(50);
});

