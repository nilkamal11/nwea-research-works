'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer } = require('../serve.js');

test('preview serves assets and survives malformed or forbidden paths', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = pathname => new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: server.address().port, path: pathname }, res => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    }).on('error', reject);
  });
  try {
    assert.equal((await request('/')).status, 200);
    assert.match((await request('/data.js')).headers['content-type'], /javascript/);
    assert.equal((await request('/%E0%A4%A')).status, 400);
    assert.equal((await request('/.git/config')).status, 403);
    assert.equal((await request('/%2e%2e/serve.js')).status, 403);
    assert.equal((await request('/does-not-exist')).status, 404);
    assert.equal((await request('/')).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
