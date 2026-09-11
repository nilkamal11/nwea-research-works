(function (root, factory) {
  'use strict';
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.NWEASnapshot = model;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const compareText = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  const compareLabel = (a, b) => compareText(String(a).toLowerCase(), String(b).toLowerCase()) || compareText(a, b);
  const asBoolean = value => value === true || value === 1 || value === '1' || value === 'true';

  function normalizeFilters(values = {}) {
    const text = key => String(values[key] == null ? '' : values[key]).trim();
    return {
      q: text('q'), cls: text('cls'), type: text('type'), theme: text('theme'),
      author: text('author'), y0: text('y0'), y1: text('y1'),
      pdf: asBoolean(values.pdf),
      roster_only: values.roster_only === undefined ? true : asBoolean(values.roster_only),
      min_shared: Math.max(1, Math.min(317, Math.trunc(Number(values.min_shared)) || 1)),
    };
  }

  function matches(work, filter) {
    if (filter.cls && !work.cls.includes(filter.cls)) return false;
    if (filter.type && !work.types.includes(filter.type)) return false;
    if (filter.theme && !work.themes.includes(filter.theme)) return false;
    if (filter.author && !work.authors.includes(filter.author)) return false;
    if (filter.y0 && work.year < filter.y0) return false;
    if (filter.y1 && work.year > filter.y1) return false;
    if (filter.pdf && !work.pdf) return false;
    const haystack = [work.title, work.byline, work.type, ...work.themes].join(' ').toLowerCase();
    return !filter.q || haystack.includes(filter.q.toLowerCase());
  }

  function tally(works, field) {
    const counts = new Map();
    works.forEach(work => {
      const values = Array.isArray(work[field]) ? work[field] : [work[field]];
      new Set(values).forEach(value => {
        if (value !== undefined && value !== null && value !== '') {
          const label = String(value);
          counts.set(label, (counts.get(label) || 0) + 1);
        }
      });
    });
    return [...counts].map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || compareLabel(a.label, b.label));
  }

  function deriveView(bootstrap, values = {}) {
    const filter = normalizeFilters(values);
    const works = bootstrap.works.filter(work => matches(work, filter));
    const selected = new Set(works.map(work => String(work.id)));
    const roster = new Set(bootstrap.meta.roster || []);
    const contributorNames = new Set(works.flatMap(work => work.authors));
    const counts = {
      classes: tally(works, 'cls'), types: tally(works, 'types'),
      themes: tally(works, 'themes'), years: tally(works, 'year'),
      contributors: tally(works, 'authors'),
    };
    counts.years.sort((a, b) => compareText(a.label, b.label));
    const types = counts.types.map(item => item.label);
    const matrix = {
      types,
      rows: counts.themes.map(({ label: theme }) => {
        const records = works.filter(work => work.themes.includes(theme));
        const typeCounts = new Map(tally(records, 'types').map(item => [item.label, item.count]));
        return { theme, total: records.length, cells: types.map(type => typeCounts.get(type) || 0) };
      }),
    };

    // Python generates all record-to-contributor and record-to-pair memberships.
    // The static page only intersects those memberships with the selected IDs.
    const nodes = bootstrap.index.nodes
      .filter(node => !filter.roster_only || node.roster)
      .map(node => ({
        id: node.id, count: 0, roster: node.roster,
        record_ids: node.record_ids.filter(id => selected.has(String(id))),
      }))
      .map(node => ({ ...node, count: node.record_ids.length }))
      .filter(node => node.count > 0)
      .sort((a, b) => b.count - a.count || compareLabel(a.id, b.id));
    const nodeIds = new Set(nodes.map(node => node.id));
    const links = bootstrap.index.links
      .filter(link => nodeIds.has(link.source) && nodeIds.has(link.target))
      .map(link => ({
        source: link.source, target: link.target, shared: 0,
        record_ids: link.record_ids.filter(id => selected.has(String(id))),
      }))
      .map(link => ({ ...link, shared: link.record_ids.length }))
      .filter(link => link.shared >= filter.min_shared)
      .sort((a, b) => b.shared - a.shared || compareLabel(a.source, b.source) || compareLabel(a.target, b.target));
    const connected = new Set(links.flatMap(link => [link.source, link.target]));
    return {
      works,
      summary: {
        records: works.length,
        bylines: works.filter(work => Boolean(work.byline)).length,
        pdfs: works.filter(work => Boolean(work.pdf)).length,
        contributors: contributorNames.size,
        roster_contributors: [...contributorNames].filter(name => roster.has(name)).length,
      },
      counts, matrix,
      graph: { nodes, links, isolated: nodes.filter(node => !connected.has(node.id)).length },
    };
  }

  return { normalizeFilters, matches, tally, deriveView, query: deriveView };
}));
