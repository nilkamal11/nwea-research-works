(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const mode = document.documentElement.dataset.mode === 'api' ? 'api' : 'static';
  const model = window.NWEASnapshot;
  const tabs = ['network', 'works', 'counts', 'themes'];
  const filterNames = ['q', 'cls', 'type', 'theme', 'author', 'y0', 'y1', 'pdf', 'roster_only', 'min_shared'];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let bootstrap;
  let currentView;
  let currentFilters = model.normalizeFilters();
  let activeTab = 'network';
  let requestSequence = 0;
  let controller;
  let searchTimer;
  let simulation;
  let graphZoom;
  let graphSvg;
  let graphPaused = reducedMotion;
  let worksLimit = 25;
  let pairsLimit = 30;
  let renderedTab = '';

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function safeUrl(value) {
    try {
      const parsed = new URL(value);
      return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null;
    } catch (_) { return null; }
  }

  function sourceLink(label, url) {
    const href = safeUrl(url);
    if (!href) return element('span', '', label);
    const link = element('a', '', label);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  function appendOption(select, value, label) {
    const option = element('option', '', label || value);
    option.value = value;
    select.appendChild(option);
  }

  function readFilters() {
    const values = {};
    filterNames.forEach(name => {
      const input = $(name);
      values[name] = input.type === 'checkbox' ? input.checked : input.value;
    });
    return model.normalizeFilters(values);
  }

  function writeFilters(values) {
    currentFilters = model.normalizeFilters(values);
    filterNames.forEach(name => {
      const input = $(name);
      if (input.type === 'checkbox') input.checked = currentFilters[name];
      else input.value = currentFilters[name];
    });
  }

  function configureFilters() {
    const allCounts = bootstrap.default_view.counts;
    const classCounts = new Map(allCounts.classes.map(item => [item.label, item.count]));
    const classes = [...(bootstrap.meta.classOrder || []), ...allCounts.classes.map(item => item.label)];
    [...new Set(classes)].filter(label => classCounts.has(label))
      .forEach(label => appendOption($('cls'), label, `${label} (${classCounts.get(label)})`));
    allCounts.themes.forEach(item => appendOption($('theme'), item.label, `${item.label} (${item.count})`));
    allCounts.contributors.forEach(item => appendOption($('author'), item.label, `${item.label} (${item.count})`));
    allCounts.types.forEach(item => appendOption($('type'), item.label, `${item.label} (${item.count})`));
    allCounts.years.forEach(item => {
      appendOption($('y0'), item.label);
      appendOption($('y1'), item.label);
    });
  }

  async function fetchJson(url, signal) {
    const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!response.ok) {
      let explanation = `The data request returned HTTP ${response.status}.`;
      try {
        const detail = await response.json();
        if (typeof detail.error === 'string') explanation = detail.error;
      } catch (_) { /* Non-JSON errors retain the HTTP status message. */ }
      throw new Error(explanation);
    }
    return response.json();
  }

  function showError(error) {
    $('error-text').textContent = `${error.message || 'The data could not be loaded.'} Try again, or open the build guide for local setup instructions.`;
    $('error-panel').hidden = false;
    $('load-status').textContent = 'The requested selection could not be loaded.';
  }

  async function load() {
    $('error-panel').hidden = true;
    $('load-status').textContent = 'Loading research records…';
    try {
      if (!window.d3) throw new Error('The local D3 library could not be loaded.');
      bootstrap = await fetchJson(mode === 'api' ? './api/bootstrap' : './data.json');
      if (!Array.isArray(bootstrap.works) || !bootstrap.index) throw new Error('The research snapshot is incomplete.');
      configureFilters();
      const pulled = bootstrap.meta.pulled || bootstrap.meta.snapshot_date || 'undated';
      $('mode-badge').textContent = mode === 'api' ? 'Python API' : 'Python-built snapshot';
      $('snapshot-note').textContent = `Saved ${pulled} · ${bootstrap.works.length.toLocaleString()} research-library entries · NWEA source metadata`;
      $('runtime-note').textContent = mode === 'api'
        ? 'Python serves the filtered records, counts, matrix, and graph through a local Flask API. D3 renders the visualizations.'
        : 'Python builds the saved data and contributor relationship index. This GitHub Pages version filters those saved memberships in the browser; Python does not run on GitHub Pages.';
      $('explorer').hidden = false;
      writeFilters(currentFilters);
      await updateView();
    } catch (error) { showError(error); }
  }

  async function updateView() {
    if (!bootstrap) return;
    const sequence = ++requestSequence;
    if (controller) controller.abort();
    controller = new AbortController();
    currentFilters = readFilters();
    $('error-panel').hidden = true;
    $('load-status').textContent = 'Updating selection…';
    $('explorer').setAttribute('aria-busy', 'true');
    try {
      if (currentFilters.y0 && currentFilters.y1 && currentFilters.y0 > currentFilters.y1) {
        throw new Error('The first posted year must not be after the last posted year.');
      }
      let view;
      if (mode === 'api') {
        const params = new URLSearchParams();
        Object.entries(currentFilters).forEach(([key, value]) => params.set(key, String(value)));
        view = await fetchJson(`./api/view?${params}`, controller.signal);
      } else {
        view = model.deriveView(bootstrap, currentFilters);
      }
      if (sequence !== requestSequence) return;
      currentView = view;
      worksLimit = 25;
      pairsLimit = 30;
      $('pair-detail').hidden = true;
      renderedTab = '';
      renderSummary();
      setTabFromHash();
      $('load-status').textContent = `${view.summary.records.toLocaleString()} records in the current selection.`;
    } catch (error) {
      if (error.name !== 'AbortError' && sequence === requestSequence) showError(error);
    } finally {
      if (sequence === requestSequence) $('explorer').removeAttribute('aria-busy');
    }
  }

  function renderSummary() {
    const summary = currentView.summary;
    $('stat-records').textContent = summary.records.toLocaleString();
    $('stat-contributors').textContent = summary.contributors.toLocaleString();
    $('stat-roster').textContent = summary.roster_contributors.toLocaleString();
    $('stat-bylines').textContent = summary.bylines.toLocaleString();
    $('stat-pdfs').textContent = summary.pdfs.toLocaleString();
    const descriptions = [];
    if (currentFilters.q) descriptions.push(`search “${currentFilters.q}”`);
    ['cls', 'type', 'theme', 'author'].forEach(name => {
      if (currentFilters[name]) descriptions.push(currentFilters[name]);
    });
    if (currentFilters.y0 || currentFilters.y1) descriptions.push(`${currentFilters.y0 || 'earliest'}–${currentFilters.y1 || 'latest'} posted years`);
    if (currentFilters.pdf) descriptions.push('PDF available');
    $('scope-note').textContent = descriptions.length
      ? `${summary.records} of ${bootstrap.works.length} saved records · ${descriptions.join(' · ')}`
      : `All ${bootstrap.works.length} saved records. Roster and shared-record controls apply only to the network.`;
  }

  function setTabFromHash() {
    const hash = location.hash.slice(1).toLowerCase();
    const next = tabs.includes(hash) ? hash : hash === 'collabs' ? 'network' : 'network';
    activeTab = next;
    tabs.forEach(tab => {
      $(`panel-${tab}`).hidden = tab !== next;
      const link = document.querySelector(`[data-tab="${tab}"]`);
      if (tab === next) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (simulation && next !== 'network') simulation.stop();
    if (!currentView || renderedTab === next) return;
    if (next === 'network') renderNetwork();
    if (next === 'works') renderWorks();
    if (next === 'counts') renderCounts();
    if (next === 'themes') renderMatrix();
    renderedTab = next;
  }

  function drilldown(overrides) {
    writeFilters({ ...currentFilters, ...overrides });
    if (location.hash !== '#works') history.pushState(null, '', '#works');
    updateView();
  }

  function renderRecord(work) {
    const card = element('article', 'record-card');
    const heading = element('h3');
    heading.appendChild(sourceLink(work.title, work.url));
    card.appendChild(heading);
    const byline = work.byline ? `${work.editors ? 'Edited by ' : ''}${work.byline}` : 'No byline saved for this record';
    card.appendChild(element('p', '', byline));
    const meta = element('div', 'record-meta');
    meta.appendChild(element('span', '', `Posted ${work.date || work.year || 'date unavailable'}`));
    work.types.forEach(type => meta.appendChild(element('span', 'tag', type)));
    if (safeUrl(work.pdf)) meta.appendChild(sourceLink('Open PDF ↗', work.pdf));
    card.appendChild(meta);
    if (work.themes.length) {
      const themeLine = element('p', 'record-themes', work.themes.join(' · '));
      themeLine.style.marginTop = '10px';
      themeLine.style.marginBottom = '0';
      card.appendChild(themeLine);
    }
    return card;
  }

  function renderWorks() {
    $('works-list').replaceChildren();
    $('works-count').textContent = `${currentView.works.length} records`;
    currentView.works.slice(0, worksLimit).forEach(work => $('works-list').appendChild(renderRecord(work)));
    if (!currentView.works.length) $('works-list').appendChild(element('p', 'empty-list', 'No records match this selection. Try clearing a filter.'));
    $('more-works').hidden = currentView.works.length <= worksLimit;
    $('more-works').textContent = `Show more records (${Math.min(worksLimit, currentView.works.length)} of ${currentView.works.length})`;
  }

  function renderContributorTable() {
    const body = $('contributors-body');
    body.replaceChildren();
    currentView.graph.nodes.forEach(node => {
      const row = element('tr');
      const nameCell = element('td');
      const button = element('button', '', node.id);
      button.type = 'button';
      button.addEventListener('click', () => drilldown({ author: node.id }));
      nameCell.appendChild(button);
      row.append(nameCell, element('td', '', node.count), element('td', '', node.roster ? 'Yes' : 'No match'));
      body.appendChild(row);
    });
    $('contributor-table-count').textContent = `${currentView.graph.nodes.length} names`;
    if (!currentView.graph.nodes.length) {
      const row = element('tr');
      const cell = element('td', '', 'No contributors in this network view.');
      cell.colSpan = 3;
      row.appendChild(cell);
      body.appendChild(row);
    }
  }

  function showPair(link) {
    const ids = new Set(link.record_ids.map(String));
    $('pair-heading').textContent = `${link.source} + ${link.target} · ${link.shared} shared records`;
    $('pair-records').replaceChildren();
    currentView.works.filter(work => ids.has(String(work.id))).forEach(work => $('pair-records').appendChild(renderRecord(work)));
    $('pair-detail').hidden = false;
    $('pair-detail').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  }

  function renderPairTable() {
    const body = $('pairs-body');
    body.replaceChildren();
    currentView.graph.links.slice(0, pairsLimit).forEach(link => {
      const row = element('tr');
      const names = element('td');
      const button = element('button', '', `${link.source} + ${link.target}`);
      button.type = 'button';
      button.addEventListener('click', () => showPair(link));
      names.appendChild(button);
      row.append(names, element('td', '', link.shared));
      body.appendChild(row);
    });
    $('pair-table-count').textContent = `${currentView.graph.links.length} pairs`;
    $('more-pairs').hidden = currentView.graph.links.length <= pairsLimit;
    if (!currentView.graph.links.length) {
      const row = element('tr');
      const cell = element('td', '', 'No pairs meet this selection and shared-record threshold.');
      cell.colSpan = 2;
      row.appendChild(cell);
      body.appendChild(row);
    }
  }

  function renderNetwork() {
    if (simulation) simulation.stop();
    $('graph-tooltip').hidden = true;
    const { graph } = currentView;
    $('graph-summary').textContent = `${graph.nodes.length} contributors · ${graph.links.length} pairs`;
    $('isolate-note').textContent = `${graph.isolated} contributor${graph.isolated === 1 ? ' has' : 's have'} no visible pair at this threshold. Those contributors remain in the view.`;
    $('network-empty').hidden = graph.nodes.length > 0;
    renderContributorTable();
    renderPairTable();
    graphSvg = d3.select('#network');
    graphSvg.selectAll('g').remove();
    const scene = graphSvg.append('g');
    graphZoom = d3.zoom().scaleExtent([0.35, 5]).on('zoom', event => scene.attr('transform', event.transform));
    graphSvg.call(graphZoom).on('dblclick.zoom', null);
    graphSvg.call(graphZoom.transform, d3.zoomIdentity);
    if (!graph.nodes.length) return;

    // D3 forceLink replaces endpoint IDs with node objects. Clone the DTO first.
    const nodes = graph.nodes.map(node => ({ ...node }));
    const links = graph.links.map(link => ({ ...link }));
    const radius = d3.scaleSqrt().domain([0, d3.max(nodes, node => node.count) || 1]).range([5, 28]);
    const edgeWidth = d3.scaleSqrt().domain([1, d3.max(links, link => link.shared) || 1]).range([0.8, 6]);
    const linkSelection = scene.append('g').attr('aria-hidden', 'true').selectAll('line')
      .data(links, link => `${link.source}\u0000${link.target}`).join('line')
      .attr('class', 'network-link').attr('stroke-width', link => edgeWidth(link.shared));
    const nodeSelection = scene.append('g').selectAll('g')
      .data(nodes, node => node.id).join('g')
      .attr('class', 'network-node').attr('role', 'button').attr('tabindex', 0)
      .attr('aria-label', node => `${node.id}, ${node.count} records. Open records.`);
    nodeSelection.append('circle').attr('r', node => radius(node.count))
      .attr('fill', node => node.roster ? '#2866b8' : '#be852d');
    nodeSelection.append('text').attr('text-anchor', 'middle')
      .attr('dy', node => radius(node.count) + 14)
      .text(node => nodes.length <= 35 || node.count >= 4 ? node.id : '');
    nodeSelection.append('title').text(node => `${node.id} · ${node.count} records`);

    const neighbors = new Map(nodes.map(node => [node.id, new Set([node.id])]));
    links.forEach(link => {
      neighbors.get(link.source).add(link.target);
      neighbors.get(link.target).add(link.source);
    });
    function highlight(node, event) {
      const connected = neighbors.get(node.id);
      nodeSelection.attr('opacity', item => connected.has(item.id) ? 1 : 0.17);
      linkSelection.attr('stroke-opacity', link => link.source.id === node.id || link.target.id === node.id ? 0.8 : 0.06);
      const tooltip = $('graph-tooltip');
      tooltip.textContent = `${node.id} · ${node.count} records · ${connected.size - 1} visible connections`;
      tooltip.hidden = false;
      const bounds = $('network').getBoundingClientRect();
      const x = event && typeof event.clientX === 'number' && event.clientX ? event.clientX - bounds.left : bounds.width / 2;
      const y = event && typeof event.clientY === 'number' && event.clientY ? event.clientY - bounds.top : 35;
      tooltip.style.left = `${Math.max(9, Math.min(bounds.width - 240, x + 12))}px`;
      tooltip.style.top = `${Math.max(9, Math.min(bounds.height - 65, y + 12))}px`;
    }
    function unhighlight() {
      nodeSelection.attr('opacity', 1);
      linkSelection.attr('stroke-opacity', 0.25);
      $('graph-tooltip').hidden = true;
    }
    nodeSelection.on('mouseenter focus', (event, node) => highlight(node, event))
      .on('mouseleave blur', unhighlight)
      .on('click', (event, node) => { if (!event.defaultPrevented) drilldown({ author: node.id }); })
      .on('keydown', (event, node) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          drilldown({ author: node.id });
        }
      });
    simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(node => node.id).distance(105).strength(0.12))
      .force('charge', d3.forceManyBody().strength(nodes.length > 80 ? -110 : -290))
      .force('collide', d3.forceCollide().radius(node => radius(node.count) + 13).iterations(2))
      .force('center', d3.forceCenter(500, 275))
      .force('x', d3.forceX(500).strength(0.025))
      .force('y', d3.forceY(275).strength(0.04))
      .alphaDecay(0.035);

    function tick() {
      nodes.forEach(node => {
        const padding = radius(node.count) + 22;
        node.x = Math.max(padding, Math.min(1000 - padding, node.x));
        node.y = Math.max(padding, Math.min(535 - padding, node.y));
      });
      linkSelection.attr('x1', link => link.source.x).attr('y1', link => link.source.y)
        .attr('x2', link => link.target.x).attr('y2', link => link.target.y);
      nodeSelection.attr('transform', node => `translate(${node.x},${node.y})`);
      nodeSelection.select('text').attr('text-anchor', node => {
        if (node.x < 110) return 'start';
        if (node.x > 890) return 'end';
        return 'middle';
      });
    }
    simulation.on('tick', tick);
    nodeSelection.call(d3.drag()
      .on('start', (event, node) => {
        if (!event.active && !graphPaused) simulation.alphaTarget(0.15).restart();
        node.fx = node.x; node.fy = node.y;
      })
      .on('drag', (event, node) => {
        node.fx = event.x; node.fy = event.y;
        node.x = event.x; node.y = event.y;
        tick();
      })
      .on('end', (event, node) => {
        if (!event.active) simulation.alphaTarget(0);
        if (!graphPaused) { node.fx = null; node.fy = null; }
      }));
    if (graphPaused) {
      simulation.stop();
      for (let i = 0; i < 160; i += 1) simulation.tick();
      tick();
    }
    $('pause-motion').textContent = graphPaused ? 'Resume motion' : 'Pause motion';
  }

  function renderBarChart(targetId, data, filterKey) {
    const container = $(targetId);
    container.replaceChildren();
    if (!data.length) {
      container.appendChild(element('p', 'small', 'No records in this selection.'));
      return;
    }
    const width = 550;
    const rowHeight = 48;
    const scale = d3.scaleLinear().domain([0, d3.max(data, item => item.count)]).range([0, width - 52]);
    const svg = d3.select(container).append('svg')
      .attr('viewBox', `0 0 ${width} ${rowHeight * data.length}`)
      .attr('role', 'group').attr('aria-label', `${filterKey} counts. Select a bar to open matching records.`);
    const rows = svg.selectAll('g').data(data, item => item.label).join('g')
      .attr('class', 'chart-row').attr('transform', (_, index) => `translate(0,${index * rowHeight})`)
      .attr('role', 'button').attr('tabindex', 0)
      .attr('aria-label', item => `${item.label}: ${item.count} records. Open records.`);
    rows.append('rect').attr('width', width).attr('height', rowHeight - 3).attr('fill', 'transparent');
    rows.append('text').attr('class', 'bar-label').attr('x', 0).attr('y', 13).text(item => item.label);
    rows.append('rect').attr('class', 'bar').attr('x', 0).attr('y', 21).attr('height', 14).attr('rx', 3)
      .attr('width', item => scale(item.count));
    rows.append('text').attr('class', 'bar-number').attr('x', item => scale(item.count) + 8).attr('y', 32).text(item => item.count);
    function choose(item) {
      const filters = filterKey === 'year' ? { y0: item.label, y1: item.label } : { [filterKey]: item.label };
      drilldown(filters);
    }
    rows.on('click', (_, item) => choose(item)).on('keydown', (event, item) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(item); }
    });
  }

  function renderCounts() {
    renderBarChart('chart-classes', currentView.counts.classes, 'cls');
    renderBarChart('chart-themes', currentView.counts.themes, 'theme');
    renderBarChart('chart-years', currentView.counts.years, 'year');
    renderBarChart('chart-types', currentView.counts.types, 'type');
  }

  function renderMatrix() {
    const container = $('matrix');
    container.replaceChildren();
    const { matrix } = currentView;
    if (!matrix.rows.length) {
      container.appendChild(element('p', 'small', 'No research themes in this selection.'));
      return;
    }
    const maximum = d3.max(matrix.rows.flatMap(row => row.cells)) || 1;
    const color = d3.scaleSequential(d3.interpolateBlues).domain([0, maximum * 1.15]);
    const table = d3.select(container).append('table').attr('class', 'matrix-table');
    table.append('caption').attr('class', 'sr-only').text('Research themes by publication type, with unique-record row totals.');
    const headings = ['Research theme', ...matrix.types, 'Unique records'];
    table.append('thead').append('tr').selectAll('th').data(headings).join('th').attr('scope', 'col').text(value => value);
    const rows = table.append('tbody').selectAll('tr').data(matrix.rows, row => row.theme).join('tr');
    rows.each(function (row) {
      const tr = d3.select(this);
      tr.append('td').append('button').attr('type', 'button').text(row.theme)
        .on('click', () => drilldown({ theme: row.theme }));
      row.cells.forEach((count, index) => {
        const cell = tr.append('td');
        if (!count) { cell.text('—').style('color', '#a8b5c5'); return; }
        cell.append('button').attr('type', 'button').text(count)
          .style('background', color(count)).style('color', count > maximum * 0.5 ? '#fff' : '#1b4b80')
          .attr('aria-label', `${row.theme}, ${matrix.types[index]}: ${count} records. Open records.`)
          .on('click', () => drilldown({ theme: row.theme, type: matrix.types[index] }));
      });
      tr.append('td').append('button').attr('type', 'button').text(row.total)
        .attr('aria-label', `${row.theme}: ${row.total} unique records. Open records.`)
        .on('click', () => drilldown({ theme: row.theme }));
    });
  }

  $('filters').addEventListener('submit', event => { event.preventDefault(); clearTimeout(searchTimer); updateView(); });
  $('q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(updateView, 220); });
  filterNames.filter(name => name !== 'q').forEach(name => $(name).addEventListener('change', () => {
    clearTimeout(searchTimer);
    updateView();
  }));
  $('clear-filters').addEventListener('click', () => { clearTimeout(searchTimer); writeFilters({}); updateView(); });
  $('retry').addEventListener('click', () => bootstrap ? updateView() : load());
  $('more-works').addEventListener('click', () => { worksLimit += 25; renderWorks(); });
  $('more-pairs').addEventListener('click', () => { pairsLimit += 50; renderPairTable(); });
  $('close-pair').addEventListener('click', () => { $('pair-detail').hidden = true; });
  $('reset-view').addEventListener('click', () => { if (graphSvg && graphZoom) graphSvg.call(graphZoom.transform, d3.zoomIdentity); });
  $('reheat').addEventListener('click', () => {
    if (!simulation) return;
    simulation.nodes().forEach(node => { node.fx = null; node.fy = null; });
    if (graphPaused) {
      simulation.alpha(0.8);
      for (let i = 0; i < 100; i += 1) simulation.tick();
      const tick = simulation.on('tick');
      if (tick) tick();
    } else simulation.alpha(0.8).restart();
  });
  $('pause-motion').addEventListener('click', () => {
    graphPaused = !graphPaused;
    if (simulation) {
      if (graphPaused) simulation.stop();
      else {
        simulation.nodes().forEach(node => { node.fx = null; node.fy = null; });
        simulation.alpha(0.4).restart();
      }
    }
    $('pause-motion').textContent = graphPaused ? 'Resume motion' : 'Pause motion';
  });
  window.addEventListener('hashchange', setTabFromHash);
  window.addEventListener('popstate', setTabFromHash);
  load();
}());
