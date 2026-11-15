import { type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = process.env.QW_SHOTS ?? 'test-results/shots';
mkdirSync(SHOTS, { recursive: true });

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

const shot = (page: Page, project: string, name: string) => page.screenshot({ path: join(SHOTS, `${project}-${name}.png`), fullPage: true });

async function register(page: Page) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Register' }).click();
  await page.getByLabel('Name').fill('Razin');
  await page.getByLabel('Email').fill(`razin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`);
  await page.getByLabel('Password').fill('test-password-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hi, Razin' })).toBeVisible({ timeout: 60_000 });
}

/** Tap dots one by one (works for mouse and touch) and press the pad's button. */
async function drawPattern(page: Page, dots: number[], button: string) {
  for (const d of dots) await page.getByRole('button', { name: new RegExp(`^Dot ${d + 1}`) }).click();
  await page.getByRole('button', { name: button, exact: true }).click();
}

test('every screen works, with data from the spreadsheet', async ({ page }, info) => {
  const p = info.project.name;
  const mobile = p === 'mobile';
  const errors = watchErrors(page);

  await test.step('register and get the starting data', async () => {
    await register(page);
    await expect(page.getByText('Atomic Habits')).toBeVisible();
    const streak = page.getByRole('region', { name: 'Clean streak' });
    await expect(streak.getByText(/^23\s*days$/)).toBeVisible();
    await expect(streak.getByText('7 days to the 30-day milestone')).toBeVisible();
    await shot(page, p, '01-home');
  });

  await test.step('clean streak: check in', async () => {
    const streak = page.getByRole('region', { name: 'Clean streak' });
    await streak.getByRole('button', { name: 'Check in: clean today' }).click();
    await expect(streak.getByText(/^24\s*days$/)).toBeVisible();
    await expect(streak.getByRole('button', { name: 'Clean today, checked in' })).toBeVisible();
  });

  await test.step('book widget: update the page', async () => {
    const w = page.getByRole('region', { name: 'Book widget' });
    await w.getByLabel('Current page').fill('150');
    await w.getByRole('button', { name: 'Update' }).click();
    await expect(w.getByLabel('Current page')).toHaveValue('150');
  });

  await test.step('quick spend from Home', async () => {
    await page.getByRole('button', { name: /quick spend/i }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Quick spend' });
    if (mobile) {
      for (const k of ['1', '2', '.', '5']) await dialog.getByRole('button', { name: k, exact: true }).click();
    } else await dialog.getByLabel('Amount in ringgit').fill('12.5');
    await dialog.getByRole('button', { name: 'Makanan Beli' }).click();
    await dialog.getByRole('button', { name: 'Save spend' }).click();
    await expect(page.getByText(/Saved RM 12\.50 · Makanan Beli/)).toBeVisible();
  });

  await test.step('Spent & Cash: allocate a budget and see the spend', async () => {
    // Move the way a person would (inside the app), not with a full reload straight after saving.
    await page.getByRole('link', { name: /Cash in hand/ }).click();
    await expect(page.getByRole('heading', { name: 'Spent & Cash' })).toBeVisible();
    await expect(page.getByText('RM 12.50').first()).toBeVisible();
    await page.getByRole('checkbox', { name: /Move Sedeqah budget/ }).click();
    await expect(page.getByRole('checkbox', { name: /Move Sedeqah budget/ })).toHaveAttribute('aria-checked', 'true');
    await shot(page, p, '05-spent');
  });

  await test.step('Money overview and checklist history', async () => {
    await page.goto('/money');
    await expect(page.getByText('Total across wallets')).toBeVisible();
    await expect(page.getByText('Tabung Haji').first()).toBeVisible();
    await expect(page.getByText('RM 21,965.29').first()).toBeVisible();
    await shot(page, p, '04-money');
    await page.goto('/money/checklist');
    await expect(page.getByRole('checkbox', { name: /Simpanan Kahwin paid for November 2026/ })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Previous month' }).click();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.getByRole('checkbox', { name: /Simpanan Emergency paid for June 2026/ })).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('checkbox', { name: /ASNB paid for June 2026/ })).toHaveAttribute('aria-checked', 'true');
    await shot(page, p, '06-checklist-june');
  });

  await test.step('transactions', async () => {
    await page.goto('/money/transactions');
    await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
    await expect(page.getByText('Makanan Beli').first()).toBeVisible();
    await shot(page, p, '07-transactions');
  });

  await test.step('habits list and a bad habit', async () => {
    await page.goto('/habits');
    await expect(page.getByRole('region', { name: 'Bad habits' }).getByText('Clean streak')).toBeVisible();
    await page.getByRole('tab', { name: 'All' }).click();
    await expect(page.getByText('Workout 30 min')).toBeVisible();
    await shot(page, p, '02-habits');
  });

  await test.step('add a habit', async () => {
    if (mobile) await page.getByRole('button', { name: 'Add habit' }).click();
    const panel = page.getByRole('region', { name: 'Add habit' });
    await panel.getByLabel('Habit name').fill('Walk 8,000 steps');
    await panel.getByRole('button', { name: 'More points' }).click();
    if (mobile) await panel.getByRole('button', { name: 'Save', exact: true }).first().click();
    else await panel.getByRole('button', { name: 'Save', exact: true }).last().click();
    await expect(page.getByRole('button', { name: 'Walk 8,000 steps' })).toBeVisible();
  });

  await test.step('habit dashboard', async () => {
    await page.goto('/habits/dashboard');
    await expect(page.getByRole('grid', { name: 'Daily habit score heatmap' })).toBeVisible();
    await page.getByRole('tab', { name: 'Month' }).click();
    await shot(page, p, '03-habit-dashboard');
  });

  await test.step('to-do: add and complete', async () => {
    await page.goto('/todo');
    await expect(page.getByText('Renew road tax')).toBeVisible();
    if (mobile) await page.getByRole('button', { name: '+ Add task' }).click();
    const panel = page.getByRole('region', { name: 'Add task' });
    await panel.getByLabel('Task').fill('Buy printer ink');
    await panel.getByRole('button', { name: 'Save', exact: true }).last().click();
    await page.getByRole('checkbox', { name: 'Mark Buy printer ink done' }).click();
    await expect(page.getByRole('checkbox', { name: 'Mark Buy printer ink done' })).toHaveAttribute('aria-checked', 'true');
    await shot(page, p, '08-todo');
  });

  await test.step('books', async () => {
    await page.goto('/books');
    await page.getByRole('button', { name: '+10' }).click();
    await expect(page.getByRole('region', { name: 'Now reading' }).getByText('160')).toBeVisible();
    await shot(page, p, '09-books');
  });

  await test.step('password vault: set up, lock, unlock with the pattern', async () => {
    await page.goto('/vault');
    await page.getByLabel('Master passphrase (8+ characters)').fill('correct horse battery');
    await page.getByLabel('Type it again').fill('correct horse battery');
    await page.getByRole('switch', { name: 'Add example accounts' }).click();
    await page.getByRole('button', { name: 'Create vault' }).click();
    await drawPattern(page, [0, 1, 2, 4], 'Next');
    await drawPattern(page, [0, 1, 2, 4], 'Confirm');
    await expect(page.getByText('Maybank2u')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Reused').first()).toBeVisible();
    await page.getByRole('button', { name: 'Show' }).first().click();
    await shot(page, p, '10-vault');
    await page.getByRole('button', { name: 'Lock now' }).click();
    await drawPattern(page, [0, 1, 2, 5], 'Unlock');
    await expect(page.getByText(/Wrong pattern/)).toBeVisible({ timeout: 30_000 });
    await drawPattern(page, [0, 1, 2, 4], 'Unlock');
    await expect(page.getByText('Maybank2u')).toBeVisible({ timeout: 30_000 });
    // Move inside the app: a full reload drops the key from memory and locks the vault (by design).
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByText('Same password, different accounts')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('3 accounts')).toBeVisible();
    await shot(page, p, '10b-vault-dashboard');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Password vault is locked' })).toBeVisible();
  });

  await test.step('reminders and settings', async () => {
    await page.goto('/reminders');
    await expect(page.getByText('Savings & Investment').first()).toBeVisible();
    await shot(page, p, '11-reminders');
    await page.goto('/settings');
    await expect(page.getByText('Monthly income (RM)')).toBeVisible();
    await shot(page, p, '12-settings');
  });

  await test.step('navigation bar reaches every section', async () => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true });
    for (const [link, heading] of mobile
      ? [['Habits', 'Habits'], ['Money', 'Money'], ['To-Do', 'To-Do'], ['More', 'More'], ['Home', 'Hi, Razin']]
      : [['Books', 'Books'], ['Passwords', 'Password vault'], ['Reminders', 'Reminders'], ['Habit dashboard', 'Habit dashboard'], ['Home', 'Hi, Razin']]) {
      await nav.getByRole('link', { name: link, exact: true }).click();
      await expect(page.getByRole('heading', { name: heading, exact: true }).filter({ visible: true })).toBeVisible();
    }
  });

  expect(errors, errors.join('\n')).toEqual([]);
});

test('PWA: installable, fast, and opens offline', async ({ page, context, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'uses Chrome DevTools throttling');
  const p = info.project.name;
  await register(page);

  await test.step('manifest and service worker', async () => {
    const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
    expect(manifest).toMatchObject({ name: 'Qawwam', display: 'standalone', theme_color: '#080402' });
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active), { timeout: 30_000 }).toBe(true);
  });

  const cdp = await context.newCDPSession(page);
  const timeToHome = async (label: string) => {
    const t0 = Date.now();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Hi, Razin' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Atomic Habits')).toBeVisible();
    const ms = Date.now() - t0;
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      return { domContentLoaded: Math.round(n.domContentLoadedEventEnd), fcp: Math.round(fcp?.startTime ?? -1) };
    });
    console.log(`[perf ${p}] ${label}: Home with data in ${ms} ms · first paint ${nav.fcp} ms · DOM ready ${nav.domContentLoaded} ms`);
    return ms;
  };

  await test.step('returning visit, normal network', async () => {
    expect(await timeToHome('warm, no throttling')).toBeLessThan(3000);
  });

  await test.step('returning visit on a slow phone (4× CPU, fast 4G)', async () => {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (4 * 1024 * 1024) / 8, uploadThroughput: (2 * 1024 * 1024) / 8 });
    expect(await timeToHome('4× CPU + fast 4G')).toBeLessThan(3000);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  });

  await test.step('offline: app opens from the service worker with cached data', async () => {
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Hi, Razin' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Atomic Habits')).toBeVisible({ timeout: 30_000 });
    await page.goto('/money');
    await expect(page.getByText('Tabung Haji').first()).toBeVisible({ timeout: 30_000 });
    await shot(page, p, '13-offline-money');
    await context.setOffline(false);
  });

  await test.step('bundle sizes', async () => {
    const sizes = await page.evaluate(() =>
      (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
        .filter((r) => r.name.endsWith('.js'))
        .map((r) => ({ file: r.name.split('/').pop(), kb: Math.round(r.decodedBodySize / 1024) })),
    );
    console.log(`[perf ${p}] scripts loaded on the Money page: ${JSON.stringify(sizes)}`);
  });
});
