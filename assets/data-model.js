(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.NWEAModel = model;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeFilter(values = {}) {
    return {
      q: '', cls: [], type: '', theme: '', author: '', y0: '', y1: '',
      pdf: false, roster: false, byline: false,
      ...values,
      cls: Array.isArray(values.cls) ? values.cls.slice() : values.cls ? [values.cls] : [],
    };
  }

  function matches(work, values) {
    const filter = normalizeFilter(values);
    if (filter.cls.length && !work.cls.some(value => filter.cls.includes(value))) return false;
    if (filter.type && !work.types.includes(filter.type)) return false;
    if (filter.theme && !work.themes.includes(filter.theme)) return false;
    if (filter.author && !work.authors.includes(filter.author)) return false;
    if (filter.y0 && work.year < filter.y0) return false;
    if (filter.y1 && work.year > filter.y1) return false;
    if (filter.pdf && !work.pdf) return false;
    if (filter.roster && !work.nwea.length) return false;
    if (filter.byline && !work.byline) return false;
    const query = filter.q.trim().toLocaleLowerCase();
    return !query || [work.title, work.byline, work.type, ...work.themes]
      .join(' ').toLocaleLowerCase().includes(query);
  }

  function filterWorks(works, filter) {
    return works.filter(work => matches(work, filter));
  }

  function drilldownFilter(scope, overrides = {}) {
    return normalizeFilter({ ...normalizeFilter(scope), ...overrides });
  }

  function tally(works, getValues) {
    const counts = new Map();
    for (const work of works) {
      const result = getValues(work);
      const values = new Set(Array.isArray(result) ? result : [result]);
      for (const value of values) {
        if (value == null || value === '') continue;
        counts.set(value, (counts.get(value) || 0) + 1);
      }
    }
    return [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  }

  function themeMatrix(works) {
    const types = tally(works, work => work.types).map(([type]) => type);
    const themes = tally(works, work => work.themes).map(([theme]) => theme);
    const rows = themes.map(theme => {
      const records = works.filter(work => work.themes.includes(theme));
      const counts = new Map(tally(records, work => work.types));
      return { theme, total: records.length, cells: types.map(type => counts.get(type) || 0) };
    });
    return { types, rows };
  }

  function buildContributorGraph(works, options = {}) {
    const roster = new Set(options.roster || []);
    const minimum = Math.max(1, Number(options.minShared) || 1);
    const contributions = new Map();
    const pairs = new Map();
    for (const work of works) {
      const contributors = [...new Set(options.rosterOnly ? work.nwea : work.authors)];
      for (const name of contributors) contributions.set(name, (contributions.get(name) || 0) + 1);
      for (let i = 0; i < contributors.length; i += 1) {
        for (let j = i + 1; j < contributors.length; j += 1) {
          const pair = [contributors[i], contributors[j]].sort();
          const key = JSON.stringify(pair);
          if (!pairs.has(key)) pairs.set(key, { source: pair[0], target: pair[1], shared: 0 });
          pairs.get(key).shared += 1;
        }
      }
    }
    const nodes = [...contributions].map(([id, count]) => ({ id, count, roster: roster.has(id) }));
    nodes.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
    const links = [...pairs.values()].filter(link => link.shared >= minimum);
    links.sort((a, b) => b.shared - a.shared || a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
    const connected = new Set(links.flatMap(link => [link.source, link.target]));
    return { nodes, links, isolated: nodes.filter(node => !connected.has(node.id)).length };
  }

  return { normalizeFilter, matches, filterWorks, drilldownFilter, tally, themeMatrix, buildContributorGraph };
}));
