/**
 * Removes generated output directories. `npm run clean` wipes everything listed; the
 * build passes `dist` as argv[2] to wipe only build output, so stale hashed chunks
 * cannot leak into a rebuild or the packed tarball. Paths resolve from this file,
 * not the cwd; `force` keeps the run idempotent when directories are already absent.
 */
import { rm } from 'node:fs/promises';
for (const target of process.argv[2] === 'dist' ? ['dist'] : ['dist', 'coverage', 'test-results', 'playwright-report', 'tmp', 'artifacts']) {
  await rm(new URL(`../${target}`, import.meta.url), { recursive: true, force: true });
}
