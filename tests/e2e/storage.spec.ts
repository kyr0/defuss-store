import { test, expect } from '@playwright/test';

test('persists a click across reload using the built public entry points', async ({ page }) => {
  await page.goto('/tests/fixtures/storage.html');
  await expect.poll(() => page.evaluate('Boolean(globalThis.fixture)')).toBe(true);
  await page.click('#increment'); await expect(page.locator('#value')).toHaveText('1');
  await page.reload(); await expect(page.locator('#value')).toHaveText('1');
  expect(await page.evaluate('fixture.writes')).toBe(0);
  expect(await page.evaluate('fixture.errors')).toEqual([]);
});
test('two pages in one context synchronize local storage once without echoes', async ({ context }) => {
  const a = await context.newPage(), b = await context.newPage();
  await Promise.all([a.goto('/tests/fixtures/storage.html'), b.goto('/tests/fixtures/storage.html')]);
  await Promise.all([a.waitForFunction('globalThis.fixture'), b.waitForFunction('globalThis.fixture')]);
  await a.evaluate('fixture.store.set(7)');
  await expect(b.locator('#value')).toHaveText('7');
  expect(await a.evaluate('fixture.writes')).toBe(1); expect(await b.evaluate('fixture.writes')).toBe(0);
  await b.evaluate('localStorage.setItem("unrelated", "5")');
  await b.evaluate('fixture.store.set(9)'); await expect(a.locator('#value')).toHaveText('9');
  expect(await a.evaluate('fixture.writes')).toBe(1); expect(await b.evaluate('fixture.writes')).toBe(1);
  await a.evaluate('fixture.persistence.clear()');
  await expect.poll(() => b.evaluate('fixture.persistence.status().hasStoredValue')).toBe(false);
  await expect(b.locator('#value')).toHaveText('9');
  expect(await b.evaluate('localStorage.getItem("fixture:counter")')).toBeNull();
  expect(await b.evaluate('localStorage.getItem("unrelated")')).toBe('5');
});
test('session storage remains isolated across independent top-level pages', async ({ context }) => {
  const a = await context.newPage(), b = await context.newPage();
  await Promise.all([a.goto('/tests/fixtures/storage.html?area=session'), b.goto('/tests/fixtures/storage.html?area=session')]);
  await Promise.all([a.waitForFunction('globalThis.fixture'), b.waitForFunction('globalThis.fixture')]);
  await a.evaluate('fixture.store.set(8)');
  await a.reload(); await expect(a.locator('#value')).toHaveText('8');
  await b.reload(); await expect(b.locator('#value')).toHaveText('0');
});
test('quota errors leave the interactive state functional', async ({ page }) => {
  await page.goto('/tests/fixtures/storage.html'); await page.waitForFunction('globalThis.fixture');
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
  await page.click('#increment'); await expect(page.locator('#value')).toHaveText('1');
  expect(await page.evaluate('fixture.persistence.status().dirty')).toBe(true);
  expect(await page.evaluate('fixture.errors')).toEqual(['write']);
});
test('imports do not acquire browser storage and explicit fallback works', async ({ page }) => {
  await page.goto('/tests/fixtures/empty.html');
  const result = await page.evaluate(async () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    // @ts-expect-error Browser URL intentionally resolved by the fixture server.
    const module = await import('/dist/browser.min.js');
    const store = module.createStore(1);
    const backend = module.createWebStorage('local', { fallback: module.createMemoryStorage() });
    const persistence = module.attachPersistence(store, { key: 'x', storage: backend, version: 1, validate: (v: unknown) => typeof v === 'number' });
    store.set(2);
    return { value: store.value, dirty: persistence.status().dirty, persisted: JSON.parse(backend.getItem('x')).value };
  });
  expect(result).toEqual({ value: 2, dirty: false, persisted: 2 });
});
test('destroy releases remote listeners', async ({ context }) => {
  const a = await context.newPage(), b = await context.newPage();
  await Promise.all([a.goto('/tests/fixtures/storage.html'), b.goto('/tests/fixtures/storage.html')]);
  await Promise.all([a.waitForFunction('globalThis.fixture'), b.waitForFunction('globalThis.fixture')]);
  await b.evaluate('fixture.persistence.destroy()'); await a.evaluate('fixture.store.set(3)');
  // An independent native event acknowledges delivery, without relying on a sleep.
  await b.evaluate(() => new Promise<void>(resolve => {
    const handler = (event: StorageEvent) => { if (event.key === 'ack') { removeEventListener('storage', handler); resolve(); } };
    addEventListener('storage', handler);
    globalThis.parent.postMessage('ready', '*');
    const frame = document.createElement('iframe'); frame.src = '/tests/fixtures/ack.html'; document.body.append(frame);
  }));
  expect(await b.evaluate('fixture.store.value')).toBe(0);
});
