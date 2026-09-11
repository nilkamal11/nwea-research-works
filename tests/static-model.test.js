'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveView, normalizeFilters } = require('../python-d3/static-model.js');

const work = (id, authors, options = {}) => ({
  id, title: `Record ${id}`, date: '2025-01-01', year: '2025',
  byline: authors.join(', '), authors, nwea: authors.filter(name => name === 'Megan'),
  types: ['Article'], type: 'Article', cls: ['Journal article'], themes: ['Growth'], pdf: '', ...options,
});
const bootstrap = {
  meta: { roster: ['Megan'] },
  works: [work('1', ['Megan', 'Emily']), work('2', ['Megan', 'Emily'], { types: ['Article', 'Brief'], pdf: 'https://example.org/2.pdf' }), work('3', ['Alex'], { year: '2024', themes: ['Equity'] })],
  index: {
    nodes: [
      { id: 'Megan', roster: true, record_ids: ['1', '2'] },
      { id: 'Emily', roster: false, record_ids: ['1', '2'] },
      { id: 'Alex', roster: false, record_ids: ['3'] },
    ],
    links: [{ source: 'Emily', target: 'Megan', record_ids: ['1', '2'] }],
  },
};

test('roster restriction affects graph only and preserves isolated nodes', () => {
  const view = deriveView(bootstrap);
  assert.equal(view.summary.records, 3);
  assert.deepEqual(view.graph.nodes.map(node => node.id), ['Megan']);
  assert.equal(view.graph.isolated, 1);
  assert.deepEqual(view.graph.links, []);
});

test('graph intersects Python memberships after filters and threshold', () => {
  const view = deriveView(bootstrap, { roster_only: false, pdf: true });
  assert.equal(view.graph.links[0].shared, 1);
  assert.deepEqual(view.graph.links[0].record_ids, ['2']);
  const threshold = deriveView(bootstrap, { roster_only: false, pdf: true, min_shared: 2 });
  assert.equal(threshold.graph.links.length, 0);
  assert.equal(threshold.graph.nodes.length, 2);
});

test('matrix row total counts each record once with multiple types', () => {
  const view = deriveView(bootstrap, { theme: 'Growth' });
  assert.equal(view.matrix.rows[0].total, 2);
  assert.equal(view.matrix.rows[0].cells.reduce((a, b) => a + b, 0), 3);
});

test('empty selection clears every derived collection without changing input', () => {
  const before = JSON.stringify(bootstrap);
  const view = deriveView(bootstrap, { q: 'unmatched text' });
  assert.equal(view.summary.records, 0);
  assert.deepEqual(view.graph, { nodes: [], links: [], isolated: 0 });
  assert.deepEqual(view.matrix, { types: [], rows: [] });
  assert.equal(JSON.stringify(bootstrap), before);
});

test('scope combines filters and years remain chronological', () => {
  assert.deepEqual(deriveView(bootstrap, { theme: 'Growth', author: 'Emily', pdf: true }).works.map(item => item.id), ['2']);
  assert.deepEqual(deriveView(bootstrap).counts.years.map(item => item.label), ['2024', '2025']);
  assert.equal(normalizeFilters({ roster_only: 'false', min_shared: '7' }).roster_only, false);
  assert.equal(normalizeFilters({ roster_only: 'false', min_shared: '7' }).min_shared, 7);
});
