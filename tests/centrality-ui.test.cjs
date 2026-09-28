'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');

function makeHarness() {
  const elements = new Map();
  const createdUrls = [];
  const revokedUrls = [];
  const anchors = [];
  const timers = [];
  const metricCalls = [];
  const selectionCalls = [];
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const handlers = new Map();
    const value = {
      value: '', checked: false, hidden: false, textContent: '', innerHTML: '',
      addEventListener(type, handler) {
        if (!handlers.has(type)) handlers.set(type, []);
        handlers.get(type).push(handler);
      },
      dispatch(type, event = {}) {
        for (const handler of handlers.get(type) || []) handler(event);
      }
    };
    elements.set(id, value);
    return value;
  }
  element('centrality-metric').value = 'betweenness';
  element('centrality-scope').value = 'person';
  const document = {
    getElementById: element,
    querySelectorAll() { return []; },
    body: { appendChild(anchor) { anchor.appended = true; } },
    createElement(tag) {
      assert.equal(tag, 'a');
      const anchor = {
        click() { this.clicked = true; },
        remove() { this.removed = true; }
      };
      anchors.push(anchor);
      return anchor;
    }
  };
  const sandbox = {
    document,
    // Use the real browser-compatible Blob to check UTF-8 BOM bytes and MIME.
    Blob,
    URL: {
      createObjectURL(blob) {
        const url = `blob:centrality-test-${createdUrls.length}`;
        createdUrls.push({ url, blob });
        return url;
      },
      revokeObjectURL(url) { revokedUrls.push(url); }
    },
    setTimeout(callback, delay) { timers.push({ callback, delay }); }
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const filename of ['centrality.js', 'centrality-ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, filename), 'utf8'), context, { filename });
  }
  function update(graph) {
    context.CornellCentralityPanel.update({
      ...graph,
      onMetric(...args) { metricCalls.push(args); },
      onSelect(id) { selectionCalls.push(id); }
    });
  }
  return { context, element, update, metricCalls, selectionCalls, createdUrls, revokedUrls, anchors, timers };
}

// RFC 4180 reader independent of the UI's CSV writer. Handles quoted commas,
// doubled quotes and embedded newlines instead of splitting on comma/newline.
function parseCsv(csv) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (char === '"') {
      if (inQuotes && csv[i + 1] === '"') { field += '"'; i += 1; }
      else inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(field); field = '';
    } else if (char === '\r' && csv[i + 1] === '\n' && !inQuotes) {
      row.push(field); rows.push(row); row = []; field = ''; i += 1;
    } else field += char;
  }
  assert.equal(inQuotes, false, 'CSV finishes outside quoted fields');
  assert.equal(field, '', 'CSV finishes with a line terminator');
  assert.equal(row.length, 0);
  return rows;
}

function starFixture() {
  return {
    type: 'project',
    nodes: [
      { id: 'a', type: 'person', name: 'Alpha, "A"\nResearcher', role: 'Faculty', disc: 'Agronomy', projects: ['P1'] },
      { id: 'b', type: 'person', name: 'Beta & <Researcher>', role: 'Student', disc: 'Agronomy', projects: ['P1'] },
      { id: 'h', type: 'hub', label: 'Project "One"\nAffiliation' }
    ],
    links: [{ source: 'a', target: 'h' }, { source: 'b', target: 'h' }]
  };
}

test('CSV exports the complete graph with correct values, UTF-8 BOM and RFC 4180 escaping after display filtering', async () => {
  const ui = makeHarness();
  const fixture = starFixture();
  ui.update(fixture);
  ui.element('centrality-scope').value = 'hub';
  ui.element('centrality-scope').dispatch('change');
  ui.element('centrality-filter').value = 'no matching affiliation';
  ui.element('centrality-filter').dispatch('input');
  assert.match(ui.element('centrality-count').textContent, /^0 of 1 groups/);
  assert.match(ui.element('centrality-rows').innerHTML, /No matching nodes/);
  ui.element('centrality-export').dispatch('click');

  assert.equal(ui.createdUrls.length, 1);
  const { blob, url } = ui.createdUrls[0];
  assert.equal(blob.type, 'text/csv;charset=utf-8');
  const buffer = Buffer.from(await blob.arrayBuffer());
  assert.deepEqual([...buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = buffer.subarray(3).toString('utf8');
  assert.ok(csv.endsWith('\r\n'));
  const rows = parseCsv(csv);
  const header = rows.shift();
  assert.deepEqual(header, [
    'network', 'id', 'name', 'node_type', 'degree', 'degree_normalized',
    'betweenness_normalized', 'harmonic_normalized', 'reachable_other_nodes',
    'component_size', 'total_nodes', 'total_edges'
  ]);
  assert.equal(rows.length, fixture.nodes.length, 'scope and search do not reduce exported nodes');
  const exported = new Map(rows.map(row => [row[1], Object.fromEntries(header.map((field, index) => [field, row[index]]))]));
  assert.equal(exported.get('a').name, 'Alpha, "A"\nResearcher');
  assert.equal(exported.get('b').name, 'Beta & <Researcher>');
  assert.equal(exported.get('h').name, 'Project "One" Affiliation');
  for (const record of exported.values()) {
    assert.equal(record.network, 'project');
    assert.equal(record.total_nodes, '3');
    assert.equal(record.total_edges, '2');
    assert.equal(record.reachable_other_nodes, '2');
    assert.equal(record.component_size, '3');
    assert.equal(record.degree_normalized, '1');
  }
  assert.equal(exported.get('h').degree, '2');
  assert.equal(exported.get('h').betweenness_normalized, '1');
  assert.equal(exported.get('h').harmonic_normalized, '1');
  assert.equal(exported.get('a').degree, '1');
  assert.equal(exported.get('a').betweenness_normalized, '0');
  assert.equal(exported.get('a').harmonic_normalized, '0.75');

  assert.equal(ui.anchors.length, 1);
  assert.equal(ui.anchors[0].href, url);
  assert.equal(ui.anchors[0].download, 'cornell-project-centrality.csv');
  assert.ok(ui.anchors[0].appended && ui.anchors[0].clicked && ui.anchors[0].removed);
  assert.deepEqual(ui.revokedUrls, [], 'URL remains alive during the download click');
  assert.equal(ui.timers.length, 1);
  assert.equal(ui.timers[0].delay, 1000);
  ui.timers[0].callback();
  assert.deepEqual(ui.revokedUrls, [url]);
});

test('filter, ranking scope and selection do not reapply force sizing; metric and sizing changes do', () => {
  const ui = makeHarness();
  const graph = starFixture();
  ui.update(graph);
  assert.equal(ui.metricCalls.length, 1);
  assert.equal(ui.metricCalls[0][0], 'betweenness');
  assert.equal(ui.metricCalls[0][1], false);
  ui.element('centrality-filter').value = 'Alpha';
  ui.element('centrality-filter').dispatch('input');
  ui.element('centrality-scope').value = 'hub';
  ui.element('centrality-scope').dispatch('change');
  ui.context.CornellCentralityPanel.select('h');
  assert.deepEqual(ui.selectionCalls, ['h']);
  assert.equal(ui.metricCalls.length, 1);
  ui.element('centrality-metric').value = 'harmonic';
  ui.element('centrality-metric').dispatch('change');
  assert.equal(ui.metricCalls.length, 2);
  assert.equal(ui.metricCalls[1][0], 'harmonic');
  ui.element('centrality-metric').dispatch('change');
  assert.equal(ui.metricCalls.length, 2, 'same metric event is a no-op for sizing');
  ui.element('centrality-size').checked = true;
  ui.element('centrality-size').dispatch('change');
  assert.equal(ui.metricCalls.length, 3);
  assert.equal(ui.metricCalls[2][1], true);
  ui.element('centrality-filter').value = '';
  ui.element('centrality-filter').dispatch('input');
  assert.equal(ui.metricCalls.length, 3);
  ui.update(graph);
  assert.equal(ui.metricCalls.length, 4, 'rebuilding the graph reapplies current sizing once');
  assert.deepEqual(ui.selectionCalls, ['h', 'h'], 'same-view redraw preserves selection');
});

test('ranking and detail escape dataset text while preserving node selection', () => {
  const ui = makeHarness();
  ui.update(starFixture());
  const rows = ui.element('centrality-rows').innerHTML;
  assert.match(rows, /Beta &amp; &lt;Researcher&gt;/);
  assert.doesNotMatch(rows, /<Researcher>/);
  assert.match(rows, /Alpha, &quot;A&quot;/);
  ui.element('centrality-rows').dispatch('click', {
    target: { closest(selector) {
      assert.equal(selector, '[data-centrality-id]');
      return { dataset: { centralityId: 'b' } };
    } }
  });
  assert.deepEqual(ui.selectionCalls, ['b']);
  assert.equal(ui.element('centrality-detail').hidden, false);
  assert.match(ui.element('centrality-detail').innerHTML, /Beta &amp; &lt;Researcher&gt;/);
  assert.match(ui.element('centrality-detail').innerHTML, /75\.000%/);
});

function actualDataset() {
  const html = fs.readFileSync(path.join(repoRoot, 'Cornell_Affiliation_Networks.html'), 'utf8');
  const from = html.indexOf('const PEOPLE =');
  const to = html.indexOf('const ROLE_COLOR =');
  assert.ok(from >= 0 && to > from, 'network page contains the affiliation dataset');
  return vm.runInNewContext(html.slice(from, to) + '\n({ PEOPLE, PROJECTS, DISCIPLINES, COUNTRIES })');
}

test('real Cornell data populates correct graph counts and equal-score project rankings across all views', () => {
  const data = actualDataset();
  const ui = makeHarness();
  const views = [
    ['project', data.PROJECTS, person => person.projects, 86, 96, 2],
    ['field', data.DISCIPLINES, person => [person.disc], 109, 83, 26],
    ['country', data.COUNTRIES, person => [person.country], 88, 83, 5]
  ];
  for (const [type, hubs, affiliations, nodeCount, edgeCount, componentCount] of views) {
    const nodes = [...data.PEOPLE.map(person => ({ ...person, type: 'person' })), ...hubs.map(hub => ({ ...hub, type: 'hub' }))];
    const links = data.PEOPLE.flatMap(person => affiliations(person).map(id => ({ source: person.id, target: id })));
    ui.update({ type, nodes, links });
    const analysis = ui.metricCalls.at(-1)[2];
    assert.equal(Number(ui.element('centrality-people').textContent), 83);
    assert.equal(Number(ui.element('centrality-groups').textContent), hubs.length);
    assert.equal(Number(ui.element('centrality-components').textContent), componentCount);
    assert.equal(analysis.nodeCount, nodeCount);
    assert.equal(analysis.edgeCount, edgeCount);
    assert.match(ui.element('centrality-count').textContent, /^83 of 83 people/);
    const rows = ui.element('centrality-rows').innerHTML;
    const firstRanks = [...rows.matchAll(/<td class="number">1<\/td>/g)].length;
    if (type === 'project') {
      const bridges = data.PEOPLE.filter(person => analysis.byId.get(person.id).betweenness > 0);
      assert.equal(bridges.length, 13);
      assert.equal(firstRanks, 13, 'all P2/P3 bridge people share rank 1');
      assert.equal([...rows.matchAll(/<td class="number">14<\/td>/g)].length, 70);
      for (const person of bridges) {
        assert.ok(Math.abs(analysis.byId.get(person.id).betweennessRaw - 63 / 13) < 1e-12);
      }
      assert.equal(analysis.byId.get('P2').degree, 75);
      assert.equal(analysis.byId.get('P1').componentSize, 9);
      assert.equal(analysis.byId.get('P2').componentSize, 77);
    } else {
      assert.equal(firstRanks, 83, 'all people tie at zero betweenness in one-affiliation views');
      for (const person of data.PEOPLE) assert.equal(analysis.byId.get(person.id).betweenness, 0);
      assert.match(ui.element('centrality-context').textContent, /all people have degree 1 and betweenness 0/);
    }
  }
});
