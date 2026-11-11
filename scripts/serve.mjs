// Tiny static server for local development: `node scripts/serve.mjs [port]`.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../docs/', import.meta.url));
const port = Number(process.env.PORT || process.argv[2] || 8080);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const devSession = fileURLToPath(new URL('../connector/.secrets/dev-session.json', import.meta.url));

createServer(async (req, res) => {
  // Local testing only: hand the page a session minted with the *local* Worker's secret (useless against production).
  if (req.url === '/__dev-session') {
    try { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(await readFile(devSession)); }
    catch { res.writeHead(404).end(); }
    return;
  }
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`LifeLog site on http://localhost:${port}`));
