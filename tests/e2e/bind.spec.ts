import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/fixtures/components.html');
  await page.waitForFunction('globalThis.fixture');
});
test('real shadcn tabs support store writes, clicks, keyboard and reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.evaluate('fixture.store.set("tabId", "billing")');
  await expect(page.locator('#billing')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#billing-panel')).toBeVisible();
  await page.click('#account');
  await expect.poll(() => page.evaluate('fixture.store.value.tabId')).toBe('account');
  const before = await page.evaluate<number>('fixture.notifications');
  await page.locator('#account').focus(); await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate('fixture.store.value.tabId')).toBe('billing');
  expect(await page.evaluate('fixture.notifications')).toBe(before + 1);
  await page.reload(); await page.waitForFunction('globalThis.fixture');
  await expect(page.locator('#billing')).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]); expect(await page.evaluate('fixture.errors')).toEqual([]);
});
test('disabled tab selection is normalized and separate instances stay separate', async ({ page }) => {
  await page.evaluate('fixture.store.set("tabId", "locked")');
  expect(await page.evaluate('fixture.store.value.tabId')).toBe('account');
  await page.click('#other-b'); await expect.poll(() => page.evaluate('fixture.other.value')).toBe('other-b');
  expect(await page.evaluate('fixture.store.value.tabId')).toBe('account');
});
test('programmatic API and attribute changes roundtrip; pagination clamps out-of-range state', async ({ page }) => {
  await page.evaluate('document.querySelector("#tabs").api.setState("active", { id: "billing" })');
  expect(await page.evaluate('fixture.store.value.tabId')).toBe('billing');
  await page.evaluate('fixture.store.set("page", 99)');
  expect(await page.evaluate('fixture.store.value.page')).toBe(5);
  await page.evaluate('document.querySelector("#pager").setAttribute("data-active-page", "2")');
  await expect.poll(() => page.evaluate('fixture.store.value.page')).toBe(2);
  await page.locator('#pager .pagination-next').click();
  await expect.poll(() => page.evaluate('fixture.store.value.page')).toBe(3);
});
test('external sidebar triggers and Ctrl+B update the store through DOM observation', async ({ page }) => {
  await page.click('[data-sidebar-trigger]'); await expect.poll(() => page.evaluate('fixture.store.value.collapsed')).toBe(true);
  await page.keyboard.press('Control+b'); await expect.poll(() => page.evaluate('fixture.store.value.collapsed')).toBe(false);
  await page.evaluate('fixture.store.set("collapsed", true)');
  await expect(page.locator('#sidebar')).toHaveAttribute('data-state', 'collapsed');
});
test('abort and repeated disposal detach observers, listeners and API wrappers', async ({ page }) => {
  await page.evaluate('fixture.abort.abort(); fixture.tabs(); fixture.tabs()');
  await page.click('#billing');
  await expect(page.locator('#billing')).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate('fixture.store.value.tabId')).toBe('account');
  await page.evaluate('fixture.store.set("tabId", "billing"); fixture.store.set("tabId", "account")');
  await expect(page.locator('#billing')).toHaveAttribute('aria-selected', 'true');
});
test('store destruction detaches bindings and retains the last readable snapshot', async ({ page }) => {
  await page.evaluate('fixture.store.destroy()');
  await page.click('#billing'); await expect(page.locator('#billing')).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate('fixture.store.value.tabId')).toBe('account');
  expect(await page.evaluate('fixture.persistence.status().phase')).toBe('destroyed');
});
