/**
 * Copies the standalone browser bundle into the docs site, the last step of `npm run build`, so the site and its
 * demo run the exact file the package ships; scripts/verify.ts fails when the copy drifts. Byte copies under the
 * original names, so the bundle's sourceMappingURL comment still finds its map. VERIFIED: scripts/verify.ts compares
 * both copies with dist/ byte for byte.
 */
import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('docs/assets/defuss-store', { recursive: true });
for (const file of ['browser.js', 'browser.js.map']) await copyFile(`dist/${file}`, `docs/assets/defuss-store/${file}`);
console.log('Copied dist/browser.js(.map) to docs/assets/defuss-store/');
