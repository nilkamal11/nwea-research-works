(function () {
  'use strict';

  const works = window.NWEA.works;
  const meta = window.NWEA.meta;
  const model = window.NWEAModel;
  const roster = new Set(meta.roster);
  const rosterDate = meta.rosterDate || meta.pulled;
  const select = selector => document.querySelector(selector);
  const views = ['works', 'counts', 'themes', 'collabs'];
  const years = [...new Set(works.map(work => work.year))].sort();
  let worksFilter = model.normalizeFilter();
  let sortOrder = 'year';
  let activeView = 'works';

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(text, className, onClick) {
    const node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function externalLink(text, url, className) {
    const link = element('a', className, text);
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return element('span', className, text);
      link.href = parsed.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } catch (_) {
      return element('span', className, text);
    }
    return link;
  }

  function populateSelect(node, values, firstLabel) {
    node.replaceChildren(new Option(firstLabel, ''));
    values.forEach(([value, count]) => node.add(new Option(`${value} (${count})`, value)));
  }

  function populateYears(start, end) {
    start.replaceChildren(new Option('Earliest', ''));
    end.replaceChildren(new Option('Latest', ''));
    years.forEach(year => start.add(new Option(year, year)));
    [...years].reverse().forEach(year => end.add(new Option(year, year)));
  }

  function showView(view, updateHash = true) {
    activeView = views.includes(view) ? view : 'works';
    document.querySelectorAll('[role="tab"][data-v]').forEach(tab => {
      const selected = tab.dataset.v === activeView;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    views.forEach(name => select(`#v-${name}`).classList.toggle('hide', name !== activeView));
    if (activeView === 'collabs') {
      sizeCanvas();
      buildNetwork();
    } else {
      stopAnimation();
    }
    if (updateHash && location.hash !== `#${activeView}`) location.hash = activeView;
  }

  document.querySelectorAll('[role="tab"][data-v]').forEach(tab => {
    tab.addEventListener('click', () => showView(tab.dataset.v));
    tab.addEventListener('keydown', event => {
      const current = views.indexOf(tab.dataset.v);
      let next;
      if (event.key === 'ArrowRight') next = (current + 1) % views.length;
      if (event.key === 'ArrowLeft') next = (current + views.length - 1) % views.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = views.length - 1;
      if (next == null) return;
      event.preventDefault();
      showView(views[next]);
      select(`#tab-${views[next]}`).focus();
    });
  });
  window.addEventListener('hashchange', () => {
    const next = views.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'works';
    if (next !== activeView) showView(next, false);
  });

  try {
    const theme = localStorage.getItem('nwea-theme');
    if (['light', 'dark'].includes(theme)) document.documentElement.dataset.theme = theme;
  } catch (_) { /* The page also works when local storage is unavailable. */ }
  select('#theme').addEventListener('click', () => {
    const root = document.documentElement;
    const current = root.dataset.theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
    root.dataset.theme = current === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('nwea-theme', root.dataset.theme); } catch (_) { /* Optional preference storage. */ }
    drawNetwork();
  });

  const workControls = {
    q: '#q', cls: '#fCls', type: '#fType', theme: '#fTheme', author: '#fAuthor',
    y0: '#fY0', y1: '#fY1', pdf: '#fPdf', roster: '#fNwea', byline: '#fByline',
  };
  populateSelect(select('#fCls'), model.tally(works, work => work.cls), 'All classes');
  populateSelect(select('#fType'), model.tally(works, work => work.types), 'All types');
  populateSelect(select('#fTheme'), model.tally(works, work => work.themes), 'All themes');
  populateSelect(select('#fAuthor'), model.tally(works, work => work.authors), 'All contributors');
  populateYears(select('#fY0'), select('#fY1'));

  Object.entries(workControls).forEach(([key, selector]) => {
    const control = select(selector);
    control.addEventListener(key === 'q' ? 'input' : 'change', () => {
      const value = control.type === 'checkbox' ? control.checked : control.value;
      worksFilter = model.normalizeFilter({ ...worksFilter, [key]: value });
      renderWorks();
    });
  });
  select('#fSort').addEventListener('change', event => {
    sortOrder = event.target.value;
    renderWorks();
  });
  select('#clear').addEventListener('click', () => setWorksFilter(model.normalizeFilter()));

  function setWorksFilter(filter, navigate = false) {
    worksFilter = model.normalizeFilter(filter);
    Object.entries(workControls).forEach(([key, selector]) => {
      const control = select(selector);
      if (control.type === 'checkbox') control.checked = worksFilter[key];
      else control.value = key === 'cls' ? (worksFilter.cls.length === 1 ? worksFilter.cls[0] : '') : worksFilter[key];
    });
    renderWorks();
    if (navigate) {
      showView('works');
      select('#tab-works').focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }

  function openScopeInWorks(scope, overrides = {}) {
    setWorksFilter(model.drilldownFilter(scope, overrides), true);
  }

  const sorters = {
    year: (a, b) => b.date.localeCompare(a.date),
    yearA: (a, b) => a.date.localeCompare(b.date),
    title: (a, b) => a.title.localeCompare(b.title),
    type: (a, b) => a.type.localeCompare(b.type) || b.date.localeCompare(a.date),
    nauth: (a, b) => b.authors.length - a.authors.length,
  };

  function workCard(work, interactiveTags = true) {
    const card = element('div', 'work');
    const content = element('div');
    const heading = element('p', 'wt');
    heading.append(externalLink(work.title || '(untitled)', work.url));
    content.append(heading);
    const byline = element('p', 'by');
    if (work.byline) {
      if (work.editors) byline.append(element('i', '', 'Edited by '));
      work.authors.forEach((name, index) => {
        if (index) byline.append(document.createTextNode(', '));
        byline.append(element(roster.has(name) ? 'b' : 'span', '', name));
      });
    } else byline.textContent = 'No byline on the source page';
    content.append(byline);
    const chips = element('div', 'chips');
    const addChip = (label, field, className) => {
      chips.append(interactiveTags
        ? button(label, className, () => setWorksFilter({ ...worksFilter, [field]: label }))
        : element('span', className, label));
    };
    work.types.forEach(type => addChip(type, 'type', 'chip t'));
    work.themes.forEach(theme => addChip(theme, 'theme', 'chip'));
    if (work.product) chips.append(element('span', 'chip static-chip', work.product));
    content.append(chips);
    const actions = element('div', 'acts');
    actions.append(element('div', 'yr', work.date), externalLink('Page', work.url, 'pill'));
    if (work.pdf) actions.append(externalLink('PDF', work.pdf, 'pill'));
    card.append(content, actions);
    return card;
  }

  function renderWorks() {
    const rows = model.filterWorks(works, worksFilter).sort(sorters[sortOrder]);
    let count = rows.length === works.length ? `${works.length} records` : `${rows.length} of ${works.length} records`;
    if (worksFilter.cls.length > 1) count += ` — ${worksFilter.cls.join(' · ')}`;
    if (worksFilter.y0 && worksFilter.y1 && worksFilter.y0 > worksFilter.y1) count += ' — start year is after end year';
    select('#wcount').textContent = count;
    const fragment = document.createDocumentFragment();
    rows.forEach(work => fragment.append(workCard(work)));
    if (!rows.length) fragment.append(element('p', 'muted', 'Nothing matches those filters.'));
    select('#list').replaceChildren(fragment);
  }

  const classOrder = meta.classOrder.filter(value => works.some(work => work.cls.includes(value)));
  const presets = [
    ['All records', []],
    ['Journal articles', ['Journal article']],
    ['Articles, books & papers', ['Journal article', 'Book', 'Conference paper', 'Working paper / preprint']],
    ['Reports & briefs', ['Report / brief', 'Practitioner guide']],
    ['Technical & psychometric', ['Technical / psychometric']],
    ['Everything but blog & web', classOrder.filter(value => value !== 'Blog / web')],
  ];

  function createScope(hostSelector, title, hint, onChange) {
    const host = select(hostSelector);
    const prefix = `${host.id}-`;
    const state = { filter: model.normalizeFilter() };
    const controls = {};
    const presetButtons = [];
    host.append(element('h2', '', title), element('p', 'muted scope-hint', hint));
    const presetRow = element('div', 'presets');
    presets.forEach(([label, classes]) => {
      const control = button(label, 'pre', () => {
        state.filter.cls = classes.slice();
        controls.cls.value = classes.length === 1 ? classes[0] : '';
        onChange();
      });
      presetButtons.push(control);
      presetRow.append(control);
    });
    host.append(presetRow);
    const fields = element('div', 'filters');
    [
      ['cls', 'Publication class'], ['type', 'Work type'], ['theme', 'Theme'],
      ['author', 'Contributor'], ['y0', 'Posted from'], ['y1', 'Posted to'],
    ].forEach(([key, label]) => {
      const group = element('div');
      const caption = element('label', 'f', label);
      caption.htmlFor = prefix + key;
      const control = element('select');
      control.id = prefix + key;
      control.addEventListener('change', () => {
        state.filter = model.normalizeFilter({ ...state.filter, [key]: control.value });
        onChange();
      });
      controls[key] = control;
      group.append(caption, control);
      fields.append(group);
    });
    populateSelect(controls.cls, model.tally(works, work => work.cls), 'All classes');
    populateSelect(controls.type, model.tally(works, work => work.types), 'All types');
    populateSelect(controls.theme, model.tally(works, work => work.themes), 'All themes');
    populateSelect(controls.author, model.tally(works, work => work.authors), 'All contributors');
    populateYears(controls.y0, controls.y1);
    host.append(fields);
    const toggles = element('div', 'togs');
    [['pdf', 'Has a PDF'], ['roster', `Has a contributor on the ${rosterDate} roster`], ['byline', 'Has a byline']]
      .forEach(([key, label]) => {
        const caption = element('label');
        const control = element('input');
        control.type = 'checkbox';
        control.id = prefix + key;
        control.addEventListener('change', () => {
          state.filter[key] = control.checked;
          onChange();
        });
        controls[key] = control;
        caption.append(control, document.createTextNode(` ${label}`));
        toggles.append(caption);
      });
    toggles.append(button('Reset', 'link', () => {
      state.filter = model.normalizeFilter();
      Object.values(controls).forEach(control => {
        if (control.type === 'checkbox') control.checked = false;
        else control.value = '';
      });
      onChange();
    }));
    toggles.append(element('span', 'spacer'), button('List these records', 'link', () => openScopeInWorks(state.filter)));
    const count = element('p', 'scope');
    count.id = prefix + 'count';
    count.setAttribute('role', 'status');
    host.append(toggles, count);
    state.rows = () => model.filterWorks(works, state.filter);
    state.paint = size => {
      presets.forEach(([, classes], index) => {
        const selected = classes.length === state.filter.cls.length && classes.every(value => state.filter.cls.includes(value));
        presetButtons[index].setAttribute('aria-pressed', String(selected));
      });
      const descriptions = [...state.filter.cls];
      ['type', 'theme', 'author'].forEach(key => { if (state.filter[key]) descriptions.push(state.filter[key]); });
      if (state.filter.y0 || state.filter.y1) descriptions.push(`posted ${state.filter.y0 || 'earliest'} to ${state.filter.y1 || 'latest'}`);
      if (state.filter.pdf) descriptions.push('has a PDF');
      if (state.filter.roster) descriptions.push(`roster ${rosterDate}`);
      if (state.filter.byline) descriptions.push('has a byline');
      count.textContent = `${size} of ${works.length} records${descriptions.length ? ` — ${descriptions.join(' · ')}` : ''}`;
      if (state.filter.y0 && state.filter.y1 && state.filter.y0 > state.filter.y1) count.textContent += ' — start year is after end year';
    };
    return state;
  }

  function renderBars(selector, data, onClick, limit) {
    const host = select(selector);
    const shown = limit ? data.slice(0, limit) : data;
    const maximum = Math.max(1, ...shown.map(([, count]) => count));
    const fragment = document.createDocumentFragment();
    shown.forEach(([label, count]) => {
      const row = element('div', 'bar');
      const caption = onClick ? button(label, 'lb bar-button', () => onClick(label)) : element('span', 'lb', label);
      caption.title = label;
      const track = element('div', 'track');
      track.setAttribute('aria-hidden', 'true');
      const fill = element('div', 'fill');
      fill.style.width = `${count / maximum * 100}%`;
      track.append(fill);
      row.append(caption, track, element('div', 'vv', String(count)));
      fragment.append(row);
    });
    host.replaceChildren(fragment);
  }

  let countScope;
  let networkScope;

  function renderCounts() {
    const rows = countScope.rows();
    countScope.paint(rows.length);
    const contributors = new Set(rows.flatMap(work => work.authors));
    const rosterCount = [...contributors].filter(name => roster.has(name)).length;
    const contributionCount = rows.reduce((total, work) => total + new Set(work.authors).size, 0);
    const metrics = [
      [rows.length, 'records in scope'],
      [rows.filter(work => work.byline).length, 'with a byline'],
      [rows.filter(work => work.pdf).length, 'with a PDF'],
      [rows.filter(work => work.nwea.length).length, `with a ${rosterDate} roster contributor`],
      [contributors.size, 'distinct contributors'],
      [rosterCount, `on saved roster (${rosterDate})`],
      [contributors.size - rosterCount, 'not on saved roster'],
      [rows.length ? (contributionCount / rows.length).toFixed(1) : '0', 'contributors per record'],
      [model.tally(rows, work => work.themes).length, 'themes'],
      [model.tally(rows, work => work.types).length, 'work types'],
    ];
    select('#kpis').replaceChildren(...metrics.map(([value, label]) => {
      const card = element('div', 'kpi');
      card.append(element('b', '', String(value)), element('span', '', label));
      return card;
    }));
    const drill = (key, value) => openScopeInWorks(countScope.filter, { [key]: value });
    renderBars('#bCls', model.tally(rows, work => work.cls), value => drill('cls', value));
    renderBars('#bType', model.tally(rows, work => work.types), value => drill('type', value));
    renderBars('#bYear', model.tally(rows, work => work.year).sort((a, b) => b[0].localeCompare(a[0])),
      value => openScopeInWorks(countScope.filter, { y0: value, y1: value }));
    renderBars('#bTheme', model.tally(rows, work => work.themes), value => drill('theme', value), 18);
    renderBars('#bAuthor', model.tally(rows, work => work.authors), value => drill('author', value), 20);
    renderBars('#bNwea', model.tally(rows, work => work.authors.filter(name => roster.has(name))), value => drill('author', value), 25);
    renderBars('#bProduct', model.tally(rows, work => work.product.split(';').map(value => value.trim()).filter(Boolean)), null, 12);
  }

  function renderMatrix() {
    const matrix = model.themeMatrix(works);
    const maximum = Math.max(1, ...matrix.rows.flatMap(row => row.cells));
    const table = element('table', 'mx');
    table.append(element('caption', '', 'Records by theme and work type. A record can have several types; the final column counts each record once.'));
    const head = element('thead');
    const heading = element('tr');
    ['Theme', ...matrix.types, 'Unique records'].forEach(label => {
      const cell = element('th', label === 'Theme' ? 'rh' : '', label);
      cell.scope = 'col';
      heading.append(cell);
    });
    head.append(heading);
    const body = element('tbody');
    matrix.rows.forEach(row => {
      const line = element('tr');
      const label = element('th', 'rh', row.theme);
      label.scope = 'row';
      line.append(label);
      row.cells.forEach((count, index) => {
        const cell = element('td', count ? '' : 'z');
        const type = matrix.types[index];
        const control = button(String(count), 'matrix-button', () => openScopeInWorks({}, { theme: row.theme, type }));
        control.setAttribute('aria-label', `${row.theme}, ${type}: ${count} records`);
        if (count) cell.style.background = `color-mix(in srgb, var(--accent) ${Math.round((0.10 + 0.62 * Math.sqrt(count / maximum)) * 100)}%, transparent)`;
        cell.append(control);
        line.append(cell);
      });
      const total = element('td', 'matrix-total');
      const control = button(String(row.total), 'matrix-button', () => openScopeInWorks({}, { theme: row.theme }));
      control.setAttribute('aria-label', `${row.theme}: ${row.total} unique records`);
      total.append(control);
      line.append(total);
      body.append(line);
    });
    table.append(head, body);
    select('#mx').replaceChildren(table);
  }

  const canvas = select('#net');
  const context = canvas.getContext('2d');
  let pixelRatio = 1;
  let nodes = [];
  let edges = [];
  let networkRows = [];
  let animation = null;
  let alpha = 0;
  let hover = null;
  let drag = null;
  let press = null;
  let viewport = { scale: 1, x: 0, y: 0 };
  const screenX = node => node.x * viewport.scale + viewport.x;
  const screenY = node => node.y * viewport.scale + viewport.y;

  function sizeCanvas() {
    pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * pixelRatio);
    canvas.height = Math.round(canvas.clientHeight * pixelRatio);
  }

  function stopAnimation() {
    if (animation != null) cancelAnimationFrame(animation);
    animation = null;
    alpha = 0;
  }

  function buildNetwork() {
    if (!networkScope) return;
    stopAnimation();
    hover = null;
    drag = null;
    press = null;
    canvas.title = '';
    canvas.style.cursor = 'default';
    networkRows = networkScope.rows();
    networkScope.paint(networkRows.length);
    const graph = model.buildContributorGraph(networkRows, {
      roster: meta.roster,
      rosterOnly: select('input[name="scope"]:checked').value === 'nwea',
      minShared: select('#minw').value,
    });
    nodes = graph.nodes.map((node, index) => {
      const distance = 9 * Math.sqrt(index + 0.5);
      const angle = index * 2.399963;
      return { ...node, x: Math.cos(angle) * distance, y: Math.sin(angle) * distance,
        vx: 0, vy: 0, radius: 4.5 + Math.sqrt(node.count) * 2.4 };
    });
    const byName = new Map(nodes.map(node => [node.id, node]));
    edges = graph.links.map(link => ({ a: byName.get(link.source), b: byName.get(link.target), shared: link.shared }));
    nodes.forEach(node => { node.degree = 0; });
    edges.forEach(edge => { edge.a.degree += 1; edge.b.degree += 1; });
    select('#netstat').textContent = nodes.length
      ? `${nodes.length} contributors, ${edges.length} links${graph.isolated ? `, ${graph.isolated} without links at this threshold` : ''}`
      : 'No contributors in this scope';
    select('#netpick').replaceChildren();
    renderNetworkTables(graph);
    if (!nodes.length || !context || activeView !== 'collabs') {
      drawNetwork();
      return;
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      alpha = 1;
      for (let step = 0; step < 240; step += 1) {
        tick();
        alpha = Math.max(0, alpha - 1 / 240);
      }
      alpha = 0;
      drawNetwork();
    } else animate(1);
  }

  function tick() {
    const size = nodes.length;
    if (!size) return;
    const repulsion = Math.max(260, 26000 / Math.sqrt(size));
    for (let i = 0; i < size; i += 1) {
      const first = nodes[i];
      first.vx -= first.x * 0.010 * alpha;
      first.vy -= first.y * 0.010 * alpha;
      for (let j = i + 1; j < size; j += 1) {
        const second = nodes[j];
        let dx = first.x - second.x;
        let dy = first.y - second.y;
        let squared = dx * dx + dy * dy;
        if (squared < 0.0001) {
          dx = 0.1 * (i + 1);
          dy = 0.1 * (j + 1);
          squared = dx * dx + dy * dy;
        }
        const distance = Math.sqrt(squared);
        const force = repulsion / Math.max(36, squared) * alpha;
        first.vx += dx / distance * force;
        first.vy += dy / distance * force;
        second.vx -= dx / distance * force;
        second.vy -= dy / distance * force;
      }
    }
    const maximum = Math.max(1, ...edges.map(edge => edge.shared));
    edges.forEach(edge => {
      const dx = edge.b.x - edge.a.x;
      const dy = edge.b.y - edge.a.y;
      const distance = Math.hypot(dx, dy) || 0.01;
      const target = 34 + 56 / Math.sqrt(edge.shared);
      // Normalize spring strength at hubs so many links cannot destabilize a step.
      const strength = 1 / Math.sqrt(Math.max(1, edge.a.degree, edge.b.degree));
      const force = (distance - target) * 0.055 * alpha * (0.45 + 0.55 * edge.shared / maximum) * strength * 0.5;
      edge.a.vx += dx / distance * force;
      edge.a.vy += dy / distance * force;
      edge.b.vx -= dx / distance * force;
      edge.b.vy -= dy / distance * force;
    });
    nodes.forEach(node => {
      if (node === drag) { node.vx = 0; node.vy = 0; return; }
      node.vx *= 0.76;
      node.vy *= 0.76;
      const speed = Math.hypot(node.vx, node.vy);
      if (speed > 12) { node.vx *= 12 / speed; node.vy *= 12 / speed; }
      node.x += node.vx;
      node.y += node.vy;
    });
  }

  function animate(strength) {
    stopAnimation();
    alpha = strength;
    function frame() {
      if (activeView !== 'collabs' || !nodes.length) { stopAnimation(); return; }
      for (let step = 0; step < 3; step += 1) {
        tick();
        alpha = Math.max(0, alpha - 0.0022);
      }
      drawNetwork();
      animation = alpha > 0.001 ? requestAnimationFrame(frame) : null;
    }
    frame();
  }

  function fitNetwork() {
    if (!nodes.length || !canvas.clientWidth || !canvas.clientHeight) return;
    const xs = nodes.map(node => node.x);
    const ys = nodes.map(node => node.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const padding = Math.min(46, canvas.clientWidth / 5);
    const scale = Math.min((canvas.clientWidth - 2 * padding) / Math.max(1, maxX - minX),
      (canvas.clientHeight - 2 * padding) / Math.max(1, maxY - minY), 4);
    viewport = { scale, x: canvas.clientWidth / 2 - scale * (minX + maxX) / 2,
      y: canvas.clientHeight / 2 - scale * (minY + maxY) / 2 };
  }

  function drawNetwork() {
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    if (!nodes.length || !canvas.clientWidth) return;
    if (!drag) fitNetwork();
    const style = getComputedStyle(document.documentElement);
    const color = name => style.getPropertyValue(name).trim();
    const accent = color('--accent'), secondary = color('--accent2'), ink = color('--ink');
    const panel = color('--panel'), line = color('--edge');
    const maximum = Math.max(1, ...edges.map(edge => edge.shared));
    const focus = drag || hover;
    const highlighted = edge => focus && (edge.a === focus || edge.b === focus);
    context.lineCap = 'round';
    [false, true].forEach(highlightPass => {
      edges.forEach(edge => {
        if (Boolean(highlighted(edge)) !== highlightPass) return;
        const weight = edge.shared / maximum;
        context.strokeStyle = highlightPass ? accent : line;
        context.globalAlpha = highlightPass ? 0.95 : focus ? 0.22 : 0.5 + 0.45 * weight;
        context.lineWidth = highlightPass ? 1.8 + 4.2 * weight : 1.1 + 3.6 * weight;
        context.beginPath();
        context.moveTo(screenX(edge.a), screenY(edge.a));
        context.lineTo(screenX(edge.b), screenY(edge.b));
        context.stroke();
      });
    });
    const neighbors = new Set();
    if (focus) edges.filter(highlighted).forEach(edge => { neighbors.add(edge.a); neighbors.add(edge.b); });
    nodes.forEach(node => {
      context.beginPath();
      context.arc(screenX(node), screenY(node), node.radius, 0, Math.PI * 2);
      context.fillStyle = node.roster ? accent : secondary;
      context.globalAlpha = !focus ? (node.roster ? 0.95 : 0.66) : node === focus ? 1 : neighbors.has(node) ? 0.95 : 0.28;
      context.fill();
      context.globalAlpha = 1;
      context.lineWidth = node === focus ? 2 : 1;
      context.strokeStyle = node === focus ? ink : panel;
      context.stroke();
    });
    drawLabels(focus, neighbors, ink, panel);
  }

  function drawLabels(focus, neighbors, ink, panel) {
    context.globalAlpha = 1;
    context.font = '600 11px -apple-system,Segoe UI,Roboto,sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.lineWidth = 3;
    context.strokeStyle = panel;
    const placed = [];
    const candidates = focus ? nodes.filter(node => node === focus || neighbors.has(node)) : nodes;
    const available = box => {
      if (box.left < 2 || box.right > canvas.clientWidth - 2 || box.top < 2 || box.bottom > canvas.clientHeight - 2) return false;
      if (placed.some(other => !(box.right < other.left || box.left > other.right || box.bottom < other.top || box.top > other.bottom))) return false;
      return !nodes.some(node => screenX(node) + node.radius + 1 > box.left && screenX(node) - node.radius - 1 < box.right
        && screenY(node) + node.radius + 1 > box.top && screenY(node) - node.radius - 1 < box.bottom);
    };
    [...candidates].sort((a, b) => (b === focus) - (a === focus) || b.count - a.count).forEach(node => {
      if (placed.length >= (focus ? 24 : 40)) return;
      const width = context.measureText(node.id).width;
      const x = screenX(node);
      for (const y of [screenY(node) - node.radius - 5, screenY(node) + node.radius + 13]) {
        const box = { left: x - width / 2 - 3, right: x + width / 2 + 3, top: y - 11, bottom: y + 3 };
        if (!available(box)) continue;
        placed.push(box);
        context.strokeText(node.id, x, y);
        context.fillStyle = ink;
        context.fillText(node.id, x, y);
        break;
      }
    });
  }

  function hitTest(event) {
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    let closest = null, shortest = Infinity;
    nodes.forEach(node => {
      const distance = Math.hypot(screenX(node) - x, screenY(node) - y);
      if (distance < Math.max(11, node.radius + 5) && distance < shortest) { closest = node; shortest = distance; }
    });
    return { node: closest, x, y };
  }

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const hit = hitTest(event);
    if (!hit.node) return;
    stopAnimation();
    drag = hit.node;
    press = { x: hit.x, y: hit.y, moved: false };
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', event => {
    const hit = hitTest(event);
    if (drag && press) {
      if (Math.hypot(hit.x - press.x, hit.y - press.y) > 4) press.moved = true;
      if (press.moved) {
        drag.x = (hit.x - viewport.x) / viewport.scale;
        drag.y = (hit.y - viewport.y) / viewport.scale;
        drag.vx = 0;
        drag.vy = 0;
      }
      drawNetwork();
      return;
    }
    canvas.style.cursor = hit.node ? 'pointer' : 'default';
    canvas.title = hit.node ? `${hit.node.id}: ${hit.node.count} records in scope` : '';
    if (hover !== hit.node) { hover = hit.node; if (!animation) drawNetwork(); }
  });
  function finishPointer(event, cancelled = false) {
    const selected = drag;
    const moved = press && press.moved;
    drag = null;
    press = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = 'default';
    if (selected && !moved && !cancelled) showContributor(selected.id);
    if (selected && moved && !matchMedia('(prefers-reduced-motion: reduce)').matches) animate(0.25);
    else drawNetwork();
  }
  canvas.addEventListener('pointerup', event => finishPointer(event));
  canvas.addEventListener('pointercancel', event => finishPointer(event, true));
  canvas.addEventListener('pointerleave', () => { if (!drag) { hover = null; drawNetwork(); } });
  window.addEventListener('resize', () => { if (activeView === 'collabs') { sizeCanvas(); drawNetwork(); } });

  function showContributor(name) {
    const rows = networkRows.filter(work => work.authors.includes(name)).sort(sorters.year);
    const heading = element('h2', 'contributor-heading', `${name} — ${rows.length} records`);
    heading.append(button('Open in the Works list', 'link contributor-open', () => openScopeInWorks(networkScope.filter, { author: name })));
    const content = [heading, element('p', 'muted', roster.has(name)
      ? `On saved roster (${rosterDate}).` : `Not on saved roster (${rosterDate}); this is not a historical affiliation classification.`)];
    rows.slice(0, 40).forEach(work => content.push(workCard(work, false)));
    if (rows.length > 40) content.push(element('p', 'muted', `${rows.length - 40} more records are available in the Works list.`));
    select('#netpick').replaceChildren(...content);
    hover = nodes.find(node => node.id === name) || null;
    drawNetwork();
  }

  function dataTable(caption, headers, rows) {
    const table = element('table', 'data-table');
    table.append(element('caption', '', caption));
    const head = element('thead');
    const heading = element('tr');
    headers.forEach(label => { const cell = element('th', '', label); cell.scope = 'col'; heading.append(cell); });
    head.append(heading);
    const body = element('tbody');
    rows.forEach(values => {
      const line = element('tr');
      values.forEach(value => { const cell = element('td'); cell.append(value instanceof Node ? value : document.createTextNode(String(value))); line.append(cell); });
      body.append(line);
    });
    table.append(head, body);
    const wrapper = element('div', 'table-scroll');
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', caption);
    wrapper.append(table);
    return wrapper;
  }

  function renderNetworkTables(graph) {
    const contributors = dataTable('Contributors in the selected scope', ['Contributor', 'Records', `Saved roster (${rosterDate})`],
      graph.nodes.map(node => [button(node.id, 'link', () => showContributor(node.id)), node.count, node.roster ? 'On saved roster' : 'Not on saved roster']));
    const links = dataTable('Shared records meeting the selected threshold', ['Contributor 1', 'Contributor 2', 'Shared records'],
      graph.links.map(link => [link.source, link.target, link.shared]));
    const note = element('p', 'muted', 'All contributors in scope remain listed, including those without a link at the selected threshold. Select a contributor to list their records below.');
    select('#networkTables').replaceChildren(note, contributors, links);
  }

  document.querySelectorAll('input[name="scope"]').forEach(control => control.addEventListener('change', buildNetwork));
  select('#minw').addEventListener('change', buildNetwork);
  select('#restart').addEventListener('click', buildNetwork);
  select('#hsub').textContent = `${works.length} records | nwea.org | snapshot ${meta.pulled}`;
  select('#foot').textContent = `Independent research-library explorer. ${works.length} source records collected ${meta.pulled}. Posted dates may differ from publication dates. Roster matching uses the saved ${rosterDate} roster and does not establish affiliation at publication. Privacy: this site records the visitor’s IP address, page, browser details, and visit time for security and basic audience measurement; records are removed after 30 days.`;
  select('#networkLegend').textContent = `Node size increases with records credited; line width increases with shared records. Darker nodes match the saved ${rosterDate} roster; other nodes are not on that roster. Hover to highlight links, drag to reposition, or select a contributor to list records.`;
  select('#networkNote').textContent = 'Names are taken from source bylines, including editors and corporate bylines. Links mean shared indexed records; they do not establish collaboration strength. Layout positions are illustrative. Related briefs, articles, and appendices may be separate records.';
  select('#fNwea').parentElement.lastChild.textContent = ` Has a contributor on the ${rosterDate} roster`;
  select('label[for="fAuthor"]').textContent = 'Contributor';
  select('input[name="scope"][value="nwea"]').parentElement.lastChild.textContent = ` Saved roster (${rosterDate}) only`;
  select('#bNwea').parentElement.querySelector('h2').textContent = `Saved-roster contributors (${rosterDate})`;
  countScope = createScope('#scopeCounts', 'What am I counting?',
    'Choose the records feeding every figure below. Chart selections preserve this scope when opening the Works list.', renderCounts);
  networkScope = createScope('#scopeNet', 'Which records feed the network?',
    'Shared-record links are calculated from the scope below. Select a publication class, theme, contributor, or posted-date range.', buildNetwork);
  renderWorks();
  renderCounts();
  renderMatrix();
  showView(location.hash.slice(1), false);
}());
