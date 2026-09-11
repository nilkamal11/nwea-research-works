const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../assets/data-model.js');

function work(id, values = {}) {
  return { id, title: `Record ${id}`, year: '2025', date: '2025-01-01',
    cls: ['Journal article'], type: 'Journal article', types: ['Journal article'],
    themes: ['Growth'], authors: ['A', 'B'], nwea: ['A'], byline: 'A, B', pdf: '', ...values };
}

test('scoped drilldowns retain all source restrictions and replace stale Works filters', () => {
  const scope = { cls: ['Journal article', 'Book'], theme: 'Growth', y0: '2024', y1: '2025', pdf: true };
  const selected = model.drilldownFilter(scope, { author: 'A' });
  assert.deepEqual(selected.cls, ['Journal article', 'Book']);
  assert.equal(selected.theme, 'Growth');
  assert.equal(selected.pdf, true);
  assert.equal(selected.author, 'A');
  assert.equal(selected.q, '');
  const records = [work('1', { pdf: 'https://example.org/1.pdf' }), work('2'), work('3', { year: '2020' })];
  assert.deepEqual(model.filterWorks(records, selected).map(row => row.id), ['1']);
  selected.cls.push('Report / brief');
  assert.equal(scope.cls.length, 2);
});

test('matrix total counts records once while type cells preserve memberships', () => {
  const matrix = model.themeMatrix([work('1', { types: ['Journal article', 'Working paper'] }), work('2')]);
  assert.equal(matrix.rows[0].total, 2);
  assert.equal(matrix.rows[0].cells.reduce((sum, count) => sum + count, 0), 3);
});

test('graph deduplicates contributors per record and uses collision-safe pair keys', () => {
  const records = [work('1', { authors: ['A', 'A', 'B'] }), work('2', { authors: ['A', 'B'] }),
    work('3', { authors: ['A || B', 'C'] }), work('4', { authors: ['A', 'B || C'] })];
  const graph = model.buildContributorGraph(records, { roster: ['A'] });
  assert.equal(graph.links.find(link => link.source === 'A' && link.target === 'B').shared, 2);
  assert.equal(graph.nodes.find(node => node.id === 'A').count, 3);
  assert.equal(graph.links.length, 3);
  assert.equal(graph.links.some(link => link.source === link.target), false);
});

test('shared-record thresholds retain and count isolated contributors', () => {
  const graph = model.buildContributorGraph([work('1'), work('2', { authors: ['C'], nwea: [] })], { minShared: 2 });
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.links.length, 0);
  assert.equal(graph.isolated, 3);
});

test('roster-only graph retains singleton roster contributors and includes credited editors', () => {
  const graph = model.buildContributorGraph([work('1', { editors: true }), work('2', { authors: ['C'], nwea: ['C'] })],
    { rosterOnly: true, roster: ['A', 'C'] });
  assert.deepEqual(graph.nodes.map(node => node.id), ['A', 'C']);
  assert.equal(graph.nodes.every(node => node.roster), true);
  assert.equal(graph.isolated, 2);
});

test('every saved matrix total and graph record count reconciles to the source snapshot', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../data.js'), 'utf8'), context);
  const snapshot = JSON.parse(JSON.stringify(context.window.NWEA));
  const matrix = model.themeMatrix(snapshot.works);
  for (const row of matrix.rows) assert.equal(row.total, snapshot.works.filter(work => work.themes.includes(row.theme)).length);
  const graph = model.buildContributorGraph(snapshot.works, { roster: snapshot.meta.roster });
  for (const node of graph.nodes) assert.equal(node.count, snapshot.works.filter(work => work.authors.includes(node.id)).length);
  for (const link of graph.links) assert.equal(link.shared, snapshot.works.filter(work => work.authors.includes(link.source) && work.authors.includes(link.target)).length);
});
