# Cornell International Agriculture Records

Public static website for research on Cornell-linked agricultural development programs in the Philippines and Southeast Asia, 1957-1972.

Website: https://kuanchiwang.github.io/cornell-agriculture/

The site includes searchable archival content and interactive affiliation networks organized by project, discipline, and state, with degree, betweenness, and harmonic centrality analysis.

## Centrality analysis

Open `Cornell_Affiliation_Networks.html` for the explorer. Each view analyzes the existing undirected, unweighted person–affiliation graph, without creating person-to-person relationships. People and affiliation groups have separate rankings; ties share a rank. Search does not change calculation scope. CSV exports include every node and full-precision normalized scores on a 0–1 scale.

- Degree is divided by the opposite partition size.
- Betweenness excludes endpoints and divides the unordered shortest-path contribution by `(N−1)(N−2)/2` (standard all-node normalization).
- Harmonic centrality is `sum(1/distance)/(N−1)`; unreachable nodes contribute zero.

`N` includes both node types. Scores indicate recorded structure, not historical importance, collaboration, or causation. The plotted dataset currently contains 83 people; counts in the explorer are derived from the data, independent of older descriptive summary tables.

The calculation is in `centrality.js`, UI in `centrality-ui.js`, and styling in `centrality.css`. Run the algorithm tests with Node.js:

```sh
node --test tests/centrality*.test.cjs
```

The 14 tests cover known graph fixtures, disconnected networks, ties, duplicate edges, every simple 3×3 bipartite graph against independent shortest-path enumeration, complete CSV export under filtering, and the real Cornell dataset.
