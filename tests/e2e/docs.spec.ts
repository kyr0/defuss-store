import { test as base, expect, type Page } from '@playwright/test';

// The docs site (docs/) as GitHub Pages serves it: the landing page and the demo app, in real Chromium, with
// defuss-shadcn from jsDelivr over the real network. Any console error, page error, failed request or HTTP error
// on any page of the test fails it.
const test = base.extend<{ errors: string[] }>({
  errors: [async ({ context, page }, use) => {
    const errors: string[] = [];
    const watch = (target: Page) => {
      target.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
      target.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      target.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
      target.on('response', (response) => { if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`); });
    };
    watch(page);
    context.on('page', watch);
    await use(errors);
    expect(errors).toEqual([]);
  }, { auto: true }],
});

const DEMO = '/docs/demo/';
const stored = (page: Page, key: string) => page.evaluate((k) => {
  const raw = localStorage.getItem(k);
  return raw === null ? null : (JSON.parse(raw) as { value: unknown }).value;
}, key);
const openDemo = async (page: Page) => {
  await page.goto(DEMO);
  await expect(page.locator('#dt-log pre').first()).toBeVisible();
};

test.describe('demo app', () => {
  test('form fields survive a reload because the store restores them, not the browser', async ({ page }) => {
    await openDemo(page);
    await page.fill('#f-name', 'Ada Lovelace');
    await page.fill('#f-email', 'ada@example.org');
    await page.selectOption('#f-role', 'designer');
    await page.check('#f-plan-enterprise');
    await page.locator('#f-newsletter').check();
    await page.fill('#f-bio', 'Line one');
    await expect(page.locator('#panel-form [data-saved]')).toContainText('Saved');
    expect(await stored(page, 'defuss-store-docs:form')).toEqual({ name: 'Ada Lovelace', email: 'ada@example.org', role: 'designer', plan: 'enterprise', newsletter: true, bio: 'Line one' });

    await page.reload();
    await expect(page.locator('#f-name')).toHaveValue('Ada Lovelace');
    await expect(page.locator('#f-email')).toHaveValue('ada@example.org');
    await expect(page.locator('#f-role')).toHaveValue('designer');
    await expect(page.locator('#f-plan-enterprise')).toBeChecked();
    await expect(page.locator('#f-newsletter')).toBeChecked();
    await expect(page.locator('#f-bio')).toHaveValue('Line one');
    await expect(page.locator('#panel-form [data-saved]')).toHaveText('Restored from localStorage');

    // Without the stored key the same reload shows the defaults: the browser itself restores nothing.
    await page.evaluate(() => localStorage.removeItem('defuss-store-docs:form'));
    await page.reload();
    await expect(page.locator('#f-name')).toHaveValue('');
    await expect(page.locator('#f-plan-hobby')).toBeChecked();
    await expect(page.locator('#f-newsletter')).not.toBeChecked();

    await page.fill('#f-name', 'Grace');
    await page.click('#panel-form button[type="reset"]');
    await expect(page.locator('#f-name')).toHaveValue('');
    expect(await stored(page, 'defuss-store-docs:form')).toMatchObject({ name: '' });
  });

  test('chat keeps the draft and the thread across a reload', async ({ page }) => {
    await openDemo(page);
    await page.click('#tab-chat');
    const composer = page.locator('#panel-chat textarea');
    await composer.fill('Hello store');
    await composer.press('Enter');
    await expect(page.locator('#chat .message[data-align="end"] .bubble-content')).toHaveText('Hello store');
    await expect(page.locator('#chat .bubble[data-variant="secondary"] .bubble-content').last()).toContainText('This thread now holds 2 messages');
    await expect(page.locator('#chat')).toHaveAttribute('aria-label', 'Chat with defuss-store');
    await composer.fill('half a sente');

    await page.reload();
    await expect(page.locator('#tab-chat')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#panel-chat textarea')).toHaveValue('half a sente');
    await expect(page.locator('#panel-chat .textarea-group-count')).toHaveText('12 / 500');
    await expect(page.locator('#chat [data-message-id]')).toHaveCount(2);
    await expect(page.locator('#chat .marker-content', { hasText: 'Restored from localStorage' })).toBeVisible();
    expect(await stored(page, 'defuss-store-docs:chat')).toMatchObject({ draft: 'half a sente' });
  });

  test('notes are added, edited and removed through store paths and survive a reload', async ({ page }) => {
    await openDemo(page);
    await page.click('#tab-notes');
    await expect(page.locator('#panel-notes .mk-empty-state')).toBeVisible();
    await page.click('[data-add-note]');
    await page.keyboard.type('first');
    await page.click('[data-add-note]');
    await page.keyboard.type('second');
    await page.click('[data-add-note]');
    await page.keyboard.type('third');
    await expect(page.locator('[data-notes-count]')).toHaveText('3 notes');
    await expect(page.locator('#dt-log pre').first()).toContainText('notes[2].text: "thir" → "third"');
    await page.click('[aria-label="Delete note 2"]');
    await expect(page.locator('#dt-log pre').first()).toContainText('notes[1]: {"id":');
    await expect(page.locator('#dt-log pre').first()).toContainText('→ ∅');
    await expect(page.locator('#dt-log pre').first()).toHaveAttribute('data-tone', 'warning');
    await expect(page.locator('.ds-note textarea')).toHaveCount(2);

    await page.reload();
    await expect(page.locator('#tab-notes')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.ds-note textarea')).toHaveCount(2);
    await expect(page.locator('.ds-note textarea').nth(0)).toHaveValue('first');
    await expect(page.locator('.ds-note textarea').nth(1)).toHaveValue('third');
    await expect(page.locator('.ds-note-label').nth(1)).toHaveText('Note 2');
    await expect(page.locator('#panel-notes .mk-empty-state')).toBeHidden();
  });

  test('Get state shows store.get(); Set state applies valid JSON and rejects the rest', async ({ page }) => {
    await openDemo(page);
    await page.fill('#f-name', 'Ada');
    await page.click('[data-action="get"][data-demo="form"]');
    await expect(page.locator('#state-dialog')).toHaveAttribute('open', '');
    await expect(page.locator('#state-call')).toHaveText('formStore.get()');
    expect(JSON.parse(await page.locator('#state-json').inputValue())).toEqual(await stored(page, 'defuss-store-docs:form'));
    await expect(page.locator('#state-json')).toHaveAttribute('readonly', '');
    await page.click('#state-dialog [data-dialog-close]');
    await expect(page.locator('#state-dialog')).not.toHaveAttribute('open', '');

    await page.click('[data-action="set"][data-demo="form"]');
    await page.fill('#state-json', '{ not json');
    await page.click('#state-apply');
    await expect(page.locator('#state-error-text')).toContainText('Not JSON');
    await page.fill('#state-json', JSON.stringify({ name: 'Eve', email: '', role: '', plan: 'hobby', newsletter: false, bio: '', admin: true }));
    await page.click('#state-apply');
    await expect(page.locator('#state-error-text')).toContainText('validate() returned false');
    await expect(page.locator('#state-error-text code')).toHaveText('validate()');
    expect(await stored(page, 'defuss-store-docs:form')).toMatchObject({ name: 'Ada' });

    await page.fill('#state-json', JSON.stringify({ name: 'Eve', email: 'eve@example.org', role: 'manager', plan: 'team', newsletter: true, bio: 'set' }));
    await page.click('#state-apply');
    await expect(page.locator('#state-dialog')).not.toHaveAttribute('open', '');
    await expect(page.locator('#f-name')).toHaveValue('Eve');
    await expect(page.locator('#f-plan-team')).toBeChecked();
    await expect(page.locator('#dt-log pre').first()).toContainText('form (root)');

    // The sample of every demo is valid for its own validator.
    for (const demo of ['chat', 'notes']) {
      await page.click(`#tab-${demo}`);
      await page.click(`[data-action="set"][data-demo="${demo}"]`);
      await page.click('#state-apply');
      await expect(page.locator('#state-dialog')).not.toHaveAttribute('open', '');
    }
    await expect(page.locator('.ds-note textarea')).toHaveCount(3);
    await page.click('#tab-chat');
    await expect(page.locator('#panel-chat textarea')).toHaveValue(/came from store\.set/);
  });

  test('devtools log every store, filter by store, and reset or clear through the API', async ({ page }) => {
    await openDemo(page);
    await expect(page.locator('#dt-log')).toContainText('attachPersistence(): nothing stored under "defuss-store-docs:form" yet');
    await page.locator('#f-name').pressSequentially('Ad');
    await expect(page.locator('#dt-log pre').first()).toContainText('form name: "A" → "Ad"');
    await expect(page.locator('#dt-persistence')).toContainText('active');
    await expect(page.locator('#dt-persistence')).toContainText('B in localStorage');
    await page.click('#tab-chat');
    await expect(page.locator('#dt-log')).toContainText('ui (root): {"tab":"form"} → {"tab":"chat"}');
    await expect(page.locator('#dt-log')).toContainText('tabs.store (root)');
    await expect(page.locator('#dt-snapshot-title')).toHaveText('chat.get()');

    await page.selectOption('#dt-filter', 'form');
    await expect(page.locator('#dt-log pre[data-store="ui"]').first()).toBeHidden();
    await expect(page.locator('#dt-log pre[data-store="form"]').first()).toBeVisible();
    await expect(page.locator('#dt-snapshot-title')).toHaveText('form.get()');

    await page.click('#dt-clear-key');
    expect(await stored(page, 'defuss-store-docs:form')).toBeNull();
    await expect(page.locator('#dt-persistence')).toContainText('nothing');
    await page.click('#dt-reset');
    await expect(page.locator('#f-name')).toHaveValue('');

    await page.click('#dt-log-clear');
    await expect(page.locator('#dt-log pre')).toHaveCount(0);
    await expect(page.locator('#dt-count code')).toHaveText('store.subscribe()');
    await expect(page.locator('#dt-snapshot-title code')).toHaveText('form.get()');
    // The snapshot is highlighted JSON: keys, strings and literals in their own spans, the text unchanged.
    await expect(page.locator('#dt-snapshot .ds-json-key').first()).toHaveText('"name"');
    await expect(page.locator('#dt-snapshot .ds-json-literal')).toHaveText(['false']);
    expect(JSON.parse(await page.locator('#dt-snapshot').innerText())).toEqual(await stored(page, 'defuss-store-docs:form'));
  });

  test('a second tab stays in sync without reloading', async ({ page, context }) => {
    await openDemo(page);
    const second = await context.newPage();
    await openDemo(second);
    await second.fill('#f-name', 'From the other tab');
    await expect(page.locator('#f-name')).toHaveValue('From the other tab');
    await expect(page.locator('#dt-log pre').first()).toContainText('form (root)');
    await page.click('#tab-notes');
    await page.click('[data-add-note]');
    await page.keyboard.type('shared');
    await second.click('#tab-notes');
    await expect(second.locator('.ds-note textarea')).toHaveValue('shared');
  });

  test('the devtools panel folds and the split is remembered', async ({ page }) => {
    await openDemo(page);
    const divider = page.locator('#devtools-region > .resizer-handle');
    const width = () => page.locator('#devtools').evaluate((el) => Math.round(el.getBoundingClientRect().width));
    const before = await width();
    await divider.focus();
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(width).toBeGreaterThan(before + 50);
    const widened = await width();
    await page.reload();
    await expect.poll(width).toBe(widened);
    await page.locator('#devtools .panel-minimize').click();
    await expect(page.locator('#devtools')).toHaveAttribute('data-minimized', '');
    await expect(page.locator('#dt-log')).toBeHidden();
  });

  test('blocked storage falls back to memory, says so, and keeps working', async ({ page }) => {
    // What private modes and sandboxed frames do: reading window.localStorage throws.
    await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } }));
    await openDemo(page);
    await expect(page.locator('#memory-only')).toBeVisible();
    await page.fill('#f-name', 'Only in memory');
    await expect(page.locator('#panel-form [data-saved]')).toContainText('In memory');
    await expect(page.locator('#dt-persistence')).toContainText('B in memory');
    await page.reload();
    await expect(page.locator('#f-name')).toHaveValue('');
  });

  test('phones stack the devtools under the demo', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDemo(page);
    await expect(page.locator('#devtools-region')).toHaveClass(/border-layout-south/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
});

test.describe('landing page', () => {
  test('renders every section and keeps its numbers and version honest', async ({ page }) => {
    await page.goto('/docs/');
    for (const id of ['intro', 'demo', 'how', 'defuss', 'api', 'numbers', 'scaling', 'install']) await expect(page.locator(`#${id}`)).toBeAttached();
    await expect(page.locator('.mk-hero-title')).toContainText('survives the page reload');
    await expect(page.locator('#playground iframe')).toHaveAttribute('src', 'demo/');
    await expect(page.frameLocator('#playground iframe').locator('#tab-form')).toBeVisible();
    await expect(page.locator('#playground-open')).toHaveAttribute('href', 'demo/');
    await expect(page.locator('#playground-open')).toHaveAttribute('target', '_blank');
    const download = await page.request.get('/docs/assets/defuss-store/browser.js');
    expect(download.ok()).toBe(true);
    await page.click('a.nav-menu-link[href="#api"]');
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#api');
    await page.locator('#flow').scrollIntoViewIfNeeded();
    await expect(page.locator('#flow .diagram-controls')).toBeVisible();
    await expect(page.locator('#flow .diagram-node')).toHaveCount(9);
    await expect(page.locator('.mk-header a[aria-label="defuss-store on npm"]')).toHaveAttribute('href', 'https://www.npmjs.com/package/defuss-store');
    const accordion = page.locator('#api-store .accordion-item').nth(1);
    await accordion.locator('summary').click();
    await expect(accordion).toHaveAttribute('open', '');
    await expect(page.locator('.fab-trigger')).toBeVisible();
  });

  test('a theme switch replaces unreadable stored theme bytes on purpose', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/docs/');
    await page.evaluate(() => localStorage.setItem('defuss-shadcn-theme', '{not json'));
    await page.reload();
    await expect(page.locator('#theme-toggle')).toBeAttached();
    expect(await page.evaluate(() => localStorage.getItem('defuss-shadcn-theme'))).toBe('{not json');
    await page.locator('label.swap:has(#theme-toggle)').click();
    await expect.poll(() => stored(page, 'defuss-shadcn-theme')).toBe('dark');
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('the scaling section charts every benchmark series from the committed snapshot', async ({ page }) => {
    await page.goto('/docs/');
    const bench = await (await page.request.get('/docs/assets/bench.json')).json() as { charts: { series: { points: unknown[] }[] }[] };
    const seriesCount = bench.charts.reduce((n, chart) => n + chart.series.length, 0);
    const pointCount = bench.charts.reduce((n, chart) => n + chart.series.reduce((m, s) => m + s.points.length, 0), 0);
    await page.locator('#scaling').scrollIntoViewIfNeeded();
    await expect(page.locator('#scaling')).toHaveAttribute('data-ready', '', { timeout: 15000 });
    await expect(page.locator('#scaling .chart svg')).toHaveCount(3);
    await expect(page.locator('.ds-takeaways li')).toHaveCount(seriesCount);
    // Every takeaway opens with the measured call, set as code; so does every table row's operation.
    await expect(page.locator('.ds-takeaways li > code:first-child')).toHaveCount(seriesCount);
    await expect(page.locator('#bench-table tbody td:nth-child(2) code')).toHaveCount(pointCount);
    await expect(page.locator('#bench-table tbody tr')).toHaveCount(pointCount);
    await expect(page.locator('#bench-meta')).toContainText('Measured');
    await expect(page.locator('[data-bench="length"] .ds-takeaways')).toContainText('flat');
    await expect(page.locator('[data-bench="depth"] .chart')).toHaveAttribute('aria-label', /linear/);
    await expect(page.locator('#bench-charts-failed')).toBeHidden();
  });

  test('without ECharts the scaling section says so and keeps every number in the table', async ({ page, errors }) => {
    await page.route('**/npm/echarts@*/**', (route) => route.abort());
    await page.goto('/docs/');
    await page.locator('#scaling').scrollIntoViewIfNeeded();
    await expect(page.locator('#bench-charts-failed')).toBeVisible();
    await expect(page.locator('#bench-table tbody tr').first()).toBeAttached();
    await expect(page.locator('.ds-takeaways li').first()).toBeVisible();
    // The blocked script and Chromium's console note about it are this test's own doing; anything else is an error.
    expect(errors.filter((error) => !error.includes('/npm/echarts@') && error !== 'console: Failed to load resource: net::ERR_FAILED')).toEqual([]);
    errors.length = 0;
  });

  test('without the snapshot the scaling section says the measurements could not load', async ({ page, errors }) => {
    await page.route('**/docs/assets/bench.json', (route) => route.abort());
    await page.goto('/docs/');
    await page.locator('#scaling').scrollIntoViewIfNeeded();
    await expect(page.locator('#bench-meta')).toHaveText(/could not be loaded/);
    await expect(page.locator('#scaling .chart svg')).toHaveCount(0);
    expect(errors.filter((error) => !error.includes('/docs/assets/bench.json') && error !== 'console: Failed to load resource: net::ERR_FAILED')).toEqual([]);
    errors.length = 0;
  });

  test('the theme switch repaints the page and the demo frame through one synced store', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/docs/');
    const frame = page.frameLocator('#playground iframe');
    await expect(frame.locator('#tab-form')).toBeVisible();
    await page.locator('label.swap:has(#theme-toggle)').click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(frame.locator('html')).toHaveClass(/dark/);
    expect(await stored(page, 'defuss-shadcn-theme')).toBe('dark');
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('#theme-toggle')).toBeChecked();
    await page.locator('label.swap:has(#theme-toggle)').click();
    await expect(frame.locator('html')).not.toHaveClass(/dark/);
  });

  test('Reload demo reloads the frame and the frame restores its state', async ({ page }) => {
    await page.goto('/docs/');
    const frame = page.frameLocator('#playground iframe');
    await frame.locator('#f-name').fill('Kept');
    await frame.locator('#tab-chat').click();
    await page.click('#playground-reload');
    await expect(frame.locator('#panel-chat')).toBeVisible();
    await frame.locator('#tab-form').click();
    await expect(frame.locator('#f-name')).toHaveValue('Kept');
    await expect(frame.locator('#panel-form [data-saved]')).toHaveText('Restored from localStorage');
  });

  test('code tabs switch, copy buttons copy, API tabs switch', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/docs/');
    await page.locator('#demo-source label', { hasText: 'notes.js' }).click();
    await expect(page.locator('#demo-source pre[data-tab="notes"]')).toBeVisible();
    await expect(page.locator('#demo-source pre[data-tab="form"]')).toBeHidden();
    await page.locator('#defuss-code label', { hasText: 'defuss JSX' }).click();
    await page.locator('#defuss-code .mk-code-block-copy').click();
    await expect(page.locator('#defuss-code .mk-code-block-status')).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("import { createStore } from 'defuss-store';");
    await page.click('#copy-prompt');
    await expect(page.locator('#copy-prompt-status')).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('https://github.com/kyr0/defuss-store');
    await page.click('#tab-persist');
    await expect(page.locator('#api-persist')).toBeVisible();
    await expect(page.locator('#api-store')).toBeHidden();
  });

  test('phones get the menu sheet and no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/docs/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.click('.mk-header-menu');
    await expect(page.locator('#ds-menu')).toHaveAttribute('open', '');
    await page.locator('#ds-menu a[href="#install"]').click();
    await expect(page.locator('#ds-menu')).not.toHaveAttribute('open', '');
  });
});
