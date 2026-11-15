#!/usr/bin/env node
// A small static file server for the browser board. ES modules and workers
// do not load from file:// URLs, so the page has to be served.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// Only the page is served.
const PUBLIC = ['web'];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

export function resolvePath(urlPath) {
  let path;
  try {
    path = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (path.endsWith('/')) path += 'index.html';
  let relative = normalize(path).replace(/^[/\\]+/, '');
  // The site's token file names its fonts from the root, /fonts/...; they live in web/fonts.
  if (relative.split(sep)[0] === 'fonts') relative = join('web', relative);
  const top = relative.split(sep)[0];
  if (!PUBLIC.includes(top) || !(extname(relative) in TYPES)) return null;
  return join(root, relative);
}

export function createAppServer() {
  return createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return;
    }
    if (request.url === '/' || request.url.startsWith('/?')) {
      response.writeHead(302, { Location: `/web/${request.url.slice(1)}` }).end();
      return;
    }
    const file = resolvePath(request.url);
    try {
      if (!file) throw new Error('not served');
      const body = await readFile(file);
      response.writeHead(200, {
        'Content-Type': TYPES[extname(file)],
        'Cache-Control': 'no-cache',
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8000;
  createAppServer().listen(port, '127.0.0.1', () => {
    console.log(`Chess board at http://localhost:${port}/`);
  });
}
