// Optional local preview. The published site does not need a server process.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon'
};

function createServer(root = __dirname) {
  root = path.resolve(root);
  return http.createServer((req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(req.url.split('?')[0]).replaceAll('\\', '/');
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    if (pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.resolve(root, '.' + pathname);
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  });
}

if (require.main === module) {
  const port = Number(process.argv[2] || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Port must be an integer between 1 and 65535.');
  }
  createServer().listen(port, '127.0.0.1', () => {
    console.log(`NWEA Research Works: http://127.0.0.1:${port}/`);
    console.log('Press Ctrl+C to stop.');
  });
}

module.exports = { createServer };
