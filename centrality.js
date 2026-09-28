/*
 * Exact centrality for the Cornell undirected, unweighted affiliation network.
 * Browser: CornellCentrality.analyze(nodes, links)
 * Node:    require('./centrality.js').analyze(nodes, links)
 *
 * nodes: unique string/number id and type ('person' or 'hub').
 * links: source/target IDs or D3 node objects. Repeated/reversed edges count once.
 * Invalid endpoints, self-loops and same-partition edges throw; inputs are not
 * mutated. All listed nodes, including isolates, belong to the analysis scope.
 *
 * Result: byId Map plus nodeCount, edgeCount, componentCount, personCount,
 * hubCount. Each byId entry contains degree, degreeNormalized, betweennessRaw,
 * betweenness, harmonicRaw, harmonic, reachable, componentSize, componentId.
 *
 * degreeNormalized = degree / opposite-partition size (0 if no opposite nodes).
 * betweennessRaw = sum over unordered distinct endpoint pairs of the fraction
 * of shortest paths through the node, excluding endpoints. Brandes' exact BFS
 * algorithm counts both directions, so its accumulation is divided by 2.
 * betweenness = betweennessRaw / choose(N-1, 2); 0 for N < 3. This is standard
 * all-node normalization, NOT the partition-specific bipartite normalization.
 * harmonicRaw = sum of 1/distance over other reachable nodes; unreachable nodes
 * contribute 0. harmonic = harmonicRaw / (N-1); 0 for N < 2.
 * reachable excludes the node itself; componentSize includes it.
 *
 * Both path-based measures use the entire selected bipartite graph, with no
 * person-only projection. Compare rankings within one node type and view.
 * References:
 * https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.bipartite.centrality.degree_centrality.html
 * https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.centrality.betweenness_centrality.html
 * https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.centrality.harmonic_centrality.html
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CornellCentrality = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function validId(id) {
    return typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
  }

  function endpointId(endpoint) {
    return endpoint !== null && typeof endpoint === 'object' ? endpoint.id : endpoint;
  }

  function analyze(nodes, links) {
    if (!Array.isArray(nodes) || !Array.isArray(links)) {
      throw new TypeError('Centrality requires node and link arrays.');
    }
    const count = nodes.length;
    const indexById = new Map();
    let personCount = 0;
    nodes.forEach(function (node, index) {
      if (!node || !validId(node.id)) throw new TypeError('Every node needs a string or finite number id.');
      if (indexById.has(node.id)) throw new Error('Duplicate node id: ' + node.id);
      if (node.type !== 'person' && node.type !== 'hub') throw new Error('Node type must be person or hub.');
      indexById.set(node.id, index);
      if (node.type === 'person') personCount += 1;
    });
    const hubCount = count - personCount;
    const neighbors = Array.from({ length: count }, function () { return new Set(); });
    let edgeCount = 0;
    links.forEach(function (link) {
      if (!link || typeof link !== 'object') throw new TypeError('Every link needs source and target endpoints.');
      const sourceId = endpointId(link.source);
      const targetId = endpointId(link.target);
      if (!indexById.has(sourceId) || !indexById.has(targetId)) throw new Error('Link endpoint is not a listed node.');
      const source = indexById.get(sourceId);
      const target = indexById.get(targetId);
      if (source === target) throw new Error('Self-loops are not affiliation edges.');
      if (nodes[source].type === nodes[target].type) throw new Error('Affiliation edges must connect a person and a hub.');
      if (!neighbors[source].has(target)) {
        neighbors[source].add(target);
        neighbors[target].add(source);
        edgeCount += 1;
      }
    });
    const adjacency = neighbors.map(function (set) { return Array.from(set); });

    const componentIds = new Int32Array(count).fill(-1);
    const componentSizes = [];
    for (let start = 0; start < count; start += 1) {
      if (componentIds[start] !== -1) continue;
      const componentId = componentSizes.length;
      const queue = [start];
      componentIds[start] = componentId;
      for (let head = 0; head < queue.length; head += 1) {
        adjacency[queue[head]].forEach(function (neighbor) {
          if (componentIds[neighbor] === -1) {
            componentIds[neighbor] = componentId;
            queue.push(neighbor);
          }
        });
      }
      componentSizes.push(queue.length);
    }

    const betweennessTwice = new Float64Array(count);
    const harmonicSums = new Float64Array(count);
    for (let source = 0; source < count; source += 1) {
      const predecessors = Array.from({ length: count }, function () { return []; });
      const pathCounts = new Float64Array(count);
      const distances = new Int32Array(count).fill(-1);
      const queue = [source];
      pathCounts[source] = 1;
      distances[source] = 0;

      // BFS gives nondecreasing distance order and all shortest-path predecessors.
      for (let head = 0; head < queue.length; head += 1) {
        const vertex = queue[head];
        if (distances[vertex] > 0) harmonicSums[source] += 1 / distances[vertex];
        adjacency[vertex].forEach(function (neighbor) {
          if (distances[neighbor] < 0) {
            distances[neighbor] = distances[vertex] + 1;
            queue.push(neighbor);
          }
          if (distances[neighbor] === distances[vertex] + 1) {
            pathCounts[neighbor] += pathCounts[vertex];
            predecessors[neighbor].push(vertex);
          }
        });
      }

      const dependency = new Float64Array(count);
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        const vertex = queue[index];
        predecessors[vertex].forEach(function (predecessor) {
          dependency[predecessor] += (pathCounts[predecessor] / pathCounts[vertex]) * (1 + dependency[vertex]);
        });
        if (vertex !== source) betweennessTwice[vertex] += dependency[vertex];
      }
    }

    const pairCount = count > 2 ? (count - 1) * (count - 2) / 2 : 0;
    const byId = new Map();
    nodes.forEach(function (node, index) {
      const oppositeCount = node.type === 'person' ? hubCount : personCount;
      const betweennessRaw = betweennessTwice[index] / 2;
      const componentId = componentIds[index];
      const componentSize = componentSizes[componentId];
      byId.set(node.id, {
        degree: adjacency[index].length,
        degreeNormalized: oppositeCount ? adjacency[index].length / oppositeCount : 0,
        betweennessRaw: betweennessRaw,
        betweenness: pairCount ? betweennessRaw / pairCount : 0,
        harmonicRaw: harmonicSums[index],
        harmonic: count > 1 ? harmonicSums[index] / (count - 1) : 0,
        reachable: componentSize - 1,
        componentSize: componentSize,
        componentId: componentId
      });
    });
    return {
      byId: byId,
      nodeCount: count,
      edgeCount: edgeCount,
      componentCount: componentSizes.length,
      personCount: personCount,
      hubCount: hubCount
    };
  }

  return Object.freeze({ analyze: analyze });
});
