'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { analyze } = require('../centrality.js');

const person = id => ({ id, type: 'person' });
const hub = id => ({ id, type: 'hub' });
const edge = (source, target) => ({ source, target });
function close(actual, expected, label = '') {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${label}: expected ${expected}, received ${actual}`);
}

test('five-node path: known bridge positions and bipartite degree denominators', () => {
  const result = analyze(
    [person('a'), hub('b'), person('c'), hub('d'), person('e')],
    [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('d', 'e')]
  );
  const a = result.byId.get('a'), b = result.byId.get('b'), c = result.byId.get('c');
  assert.equal(result.componentCount, 1);
  assert.equal(result.edgeCount, 4);
  assert.equal(result.personCount, 3);
  assert.equal(result.hubCount, 2);
  assert.equal(c.degree, 2);
  close(c.degreeNormalized, 1);
  close(b.degreeNormalized, 2 / 3);
  close(a.degreeNormalized, 1 / 2);
  close(a.betweennessRaw, 0);
  close(b.betweennessRaw, 3);
  close(c.betweennessRaw, 4);
  close(b.betweenness, 1 / 2);
  close(c.betweenness, 2 / 3);
  close(a.harmonicRaw, 25 / 12);
  close(a.harmonic, 25 / 48);
  close(c.harmonic, 3 / 4);
  assert.equal(a.reachable, 4);
  assert.equal(a.componentSize, 5);
});

test('star: central hub lies on every leaf-pair path; leaves have no betweenness', () => {
  const result = analyze(
    [hub('h'), person('a'), person('b'), person('c')],
    [edge('a', 'h'), edge('b', 'h'), edge('c', 'h')]
  );
  const center = result.byId.get('h');
  close(center.betweennessRaw, 3);
  close(center.betweenness, 1);
  close(center.degreeNormalized, 1);
  close(center.harmonic, 1);
  for (const id of ['a', 'b', 'c']) {
    close(result.byId.get(id).betweenness, 0);
    close(result.byId.get(id).harmonic, 2 / 3);
    close(result.byId.get(id).degreeNormalized, 1);
  }
});

test('diamond: alternative equally short paths split credit exactly', () => {
  const result = analyze(
    [person('a'), person('c'), hub('b'), hub('d')],
    [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('d', 'a')]
  );
  for (const metrics of result.byId.values()) {
    close(metrics.betweennessRaw, 1 / 2);
    close(metrics.betweenness, 1 / 6);
    close(metrics.harmonic, 5 / 6);
    close(metrics.degreeNormalized, 1);
  }
});

test('disconnected graph uses global denominators and unreachable nodes contribute zero', () => {
  const result = analyze(
    [person('a'), person('b'), person('isolated'), hub('h')],
    [edge('a', 'h'), edge('b', 'h')]
  );
  const center = result.byId.get('h'), leaf = result.byId.get('a');
  assert.equal(result.componentCount, 2);
  assert.equal(center.componentSize, 3);
  assert.equal(center.reachable, 2);
  close(center.betweennessRaw, 1);
  close(center.betweenness, 1 / 3);
  close(center.degreeNormalized, 2 / 3);
  close(center.harmonic, 2 / 3);
  close(leaf.harmonic, 1 / 2);
  const isolated = result.byId.get('isolated');
  assert.equal(isolated.componentSize, 1);
  assert.equal(isolated.reachable, 0);
  for (const key of ['degree', 'degreeNormalized', 'betweennessRaw', 'betweenness', 'harmonicRaw', 'harmonic']) {
    assert.equal(isolated[key], 0);
  }
  assert.notEqual(isolated.componentId, center.componentId);
});

test('empty, singleton, all-isolated and two-node graphs remain finite', () => {
  const empty = analyze([], []);
  assert.equal(empty.nodeCount, 0);
  assert.equal(empty.edgeCount, 0);
  assert.equal(empty.componentCount, 0);
  for (const nodes of [[person('a')], [person('a'), person('b')]]) {
    const result = analyze(nodes, []);
    assert.equal(result.componentCount, nodes.length);
    for (const metrics of result.byId.values()) {
      assert.equal(metrics.degreeNormalized, 0);
      assert.equal(metrics.betweenness, 0);
      assert.equal(metrics.harmonic, 0);
      assert.equal(metrics.componentSize, 1);
    }
  }
  const pair = analyze([person('a'), hub('h')], [edge('a', 'h')]);
  for (const metrics of pair.byId.values()) {
    assert.equal(metrics.degreeNormalized, 1);
    assert.equal(metrics.betweenness, 0);
    assert.equal(metrics.harmonic, 1);
  }
});

test('duplicate/reversed links and D3 endpoint objects do not multiply affiliations or mutate inputs', () => {
  const nodes = [person('a'), person('b'), hub('h')].map(Object.freeze);
  const links = [edge('a', 'h'), edge(nodes[2], nodes[0]), edge('b', nodes[2])].map(Object.freeze);
  Object.freeze(nodes);
  Object.freeze(links);
  const before = JSON.stringify({ nodes, links });
  const result = analyze(nodes, links);
  assert.equal(result.edgeCount, 2);
  assert.equal(result.byId.get('a').degree, 1);
  assert.equal(result.byId.get('h').degree, 2);
  close(result.byId.get('h').betweennessRaw, 1);
  assert.equal(JSON.stringify({ nodes, links }), before);
});

test('string and number IDs are distinct; prototype-like string IDs are safe', () => {
  const result = analyze([person(1), person('1'), person('__proto__'), hub('constructor')],
    [edge(1, 'constructor'), edge('__proto__', 'constructor')]);
  assert.equal(result.byId.get(1).degree, 1);
  assert.equal(result.byId.get('1').degree, 0);
  assert.equal(result.byId.get('__proto__').degree, 1);
  assert.equal(result.byId.get('constructor').degree, 2);
});

test('invalid graph inputs fail explicitly', () => {
  const validNodes = [person('a'), person('b'), hub('h')];
  assert.throws(() => analyze({}, []), /arrays/);
  assert.throws(() => analyze([], null), /arrays/);
  assert.throws(() => analyze([null], []), /id/);
  assert.throws(() => analyze([person(NaN)], []), /id/);
  assert.throws(() => analyze([person({})], []), /id/);
  assert.throws(() => analyze([person('a'), hub('a')], []), /Duplicate/);
  assert.throws(() => analyze([{ id: 'a', type: 'other' }], []), /type/);
  assert.throws(() => analyze(validNodes, [null]), /endpoints/);
  assert.throws(() => analyze(validNodes, [{}]), /endpoint/);
  assert.throws(() => analyze(validNodes, [edge('a', 'missing')]), /endpoint/);
  assert.throws(() => analyze(validNodes, [edge('a', 'a')]), /Self-loops/);
  assert.throws(() => analyze(validNodes, [edge('a', 'b')]), /person and a hub/);
});

// Independent oracle: enumerate simple paths on these small graphs and retain
// shortest ones, rather than reproducing the Brandes dependency recurrence.
function enumerateShortestPaths(adjacency, source, target) {
  let minimum = Infinity;
  const shortest = [];
  function visit(current, route) {
    if (route.length > minimum) return;
    if (current === target) {
      if (route.length < minimum) {
        minimum = route.length;
        shortest.length = 0;
      }
      shortest.push(route);
      return;
    }
    for (const neighbor of adjacency[current]) {
      if (!route.includes(neighbor)) visit(neighbor, [...route, neighbor]);
    }
  }
  visit(source, [source]);
  return shortest;
}

test('all 512 simple 3-by-3 affiliation graphs agree with an independent exhaustive path oracle', () => {
  const nodes = [person(0), person(1), person(2), hub(3), hub(4), hub(5)];
  const possibleEdges = nodes.slice(0, 3).flatMap(p => nodes.slice(3).map(h => edge(p.id, h.id)));
  for (let mask = 0; mask < 512; mask += 1) {
    const links = possibleEdges.filter((_, index) => mask & (1 << index));
    const result = analyze(nodes, links);
    const adjacency = Array.from({ length: 6 }, () => []);
    links.forEach(({ source, target }) => {
      adjacency[source].push(target);
      adjacency[target].push(source);
    });
    const expectedBetweenness = new Array(6).fill(0);
    const expectedHarmonic = new Array(6).fill(0);
    for (let source = 0; source < 6; source += 1) {
      for (let target = source + 1; target < 6; target += 1) {
        const paths = enumerateShortestPaths(adjacency, source, target);
        if (!paths.length) continue;
        const reciprocalDistance = 1 / (paths[0].length - 1);
        expectedHarmonic[source] += reciprocalDistance;
        expectedHarmonic[target] += reciprocalDistance;
        for (const route of paths) {
          for (const interior of route.slice(1, -1)) expectedBetweenness[interior] += 1 / paths.length;
        }
      }
    }
    for (let id = 0; id < 6; id += 1) {
      const metrics = result.byId.get(id);
      close(metrics.betweennessRaw, expectedBetweenness[id], `graph ${mask}, node ${id}, betweennessRaw`);
      close(metrics.betweenness, expectedBetweenness[id] / 10, `graph ${mask}, node ${id}, betweenness`);
      close(metrics.harmonic, expectedHarmonic[id] / 5, `graph ${mask}, node ${id}, harmonic`);
      close(metrics.degreeNormalized, adjacency[id].length / 3, `graph ${mask}, node ${id}, degree`);
    }
  }
});

test('browser global exposes the same API without CommonJS', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'centrality.js'), 'utf8'), context);
  assert.equal(typeof context.CornellCentrality.analyze, 'function');
  const result = context.CornellCentrality.analyze([person('a'), hub('h')], [edge('a', 'h')]);
  assert.equal(result.byId.get('a').harmonic, 1);
  assert.equal(result.componentCount, 1);
});
