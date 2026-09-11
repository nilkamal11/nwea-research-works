'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { deriveView } = require('../python-d3/static-model.js');

const root = path.resolve(__dirname, '..');
const bootstrap = JSON.parse(fs.readFileSync(path.join(root, 'python-d3/data.json'), 'utf8'));
const cases = [
  {},
  { roster_only: false },
  { cls: 'Journal article', theme: 'Equity', roster_only: false },
  { theme: 'Growth', min_shared: 3 },
  { author: 'Megan Kuhfeld', q: 'Megan', y0: '2020', y1: '2024', pdf: true },
  { q: 'no matching publication exists here', roster_only: false },
  { min_shared: 317, roster_only: false },
  { type: 'Book', roster_only: false },
  { q: 'Sharon Bi', roster_only: false },
];

function comparable(view) {
  const ordered = values => values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    recordIds: view.works.map(work => work.id),
    summary: view.summary,
    counts: Object.fromEntries(Object.entries(view.counts).map(([name, values]) => [
      name, ordered(values.map(item => [item.label, item.count])),
    ])),
    matrix: ordered(view.matrix.rows.map(row => [
      row.theme, row.total,
      ordered(view.matrix.types.map((type, index) => [type, row.cells[index]])),
    ])),
    nodes: ordered(view.graph.nodes.map(node => [node.id, node.count, node.roster, node.record_ids])),
    links: ordered(view.graph.links.map(link => [link.source, link.target, link.shared, link.record_ids])),
    isolated: view.graph.isolated,
  };
}

test('static D3 data adapter matches Python for filters, matrices, graph weights, and record provenance', () => {
  const environmentPython = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const python = process.env.PYTHON_BIN || (fs.existsSync(environmentPython) ? environmentPython : 'python');
  const script = [
    'import json, sys',
    'from python_d3.analytics import ResearchAnalytics',
    'analytics = ResearchAnalytics()',
    'print(json.dumps([analytics.query(case) for case in json.load(sys.stdin)], ensure_ascii=True))',
  ].join('\n');
  const result = spawnSync(python, ['-c', script], {
    cwd: root, input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error || 'Python failed'));
  const expected = JSON.parse(result.stdout);
  cases.forEach((filters, index) => {
    assert.deepEqual(comparable(deriveView(bootstrap, filters)), comparable(expected[index]), JSON.stringify(filters));
  });
});
