/**
 * Static file server over the repo root, bound to loopback. `npm run dev` serves the
 * browser example (/ maps to examples/index.html); Playwright's webServer config runs
 * the same server so e2e specs load tests/fixtures and dist over HTTP. PORT overrides
 * the default 4178. Responses are no-store: tests must never see a cached build.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.map': 'application/json' };
const server = createServer(async (request, response) => {
  try {
    // A dummy base makes the relative request target parseable; decoding may throw → 404 below.
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const file = resolve(root, `.${pathname === '/' ? '/examples/index.html' : pathname}`);
    // Compare against root plus a separator, or a sibling like "<root>-evil" would pass the prefix check.
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) { response.writeHead(403).end(); return; }
    if (!(await stat(file)).isFile()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(await readFile(file));
  // stat ENOENT, malformed percent-encoding and read races all surface as 404: this is a dev/test server.
  } catch { response.writeHead(404).end('Not found'); }
});
const port = Number(process.env.PORT ?? 4178);
server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
// Playwright stops the webServer with a signal; drain and exit so the fixed port is free for the next run.
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => server.close(() => process.exit(0)));
