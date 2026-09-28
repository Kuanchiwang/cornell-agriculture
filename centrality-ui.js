/* UI for centrality of the existing two-mode affiliation graph. No data leaves the browser. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const metrics = {
    degreeNormalized: { label: 'Degree', explanation: 'Direct affiliations for people; participating people for groups. The percentage divides by the number of nodes in the opposite group.' },
    betweenness: { label: 'Betweenness', explanation: 'Share of shortest paths between other nodes that pass through this node. Higher values identify structural bridges in this affiliation graph.' },
    harmonic: { label: 'Harmonic', explanation: 'Reach through short paths: the sum of reciprocal distances, divided by all other nodes. Unreachable nodes contribute zero.' }
  };
  let state = null;
  let selectedId = null;
  let appliedMetric = null;
  const percent = n => `${(100 * n).toFixed(3)}%`;
  const name = node => node.name || node.label.replace(/\n/g, ' ');
  const equalScore = (a, b) => Math.abs(a - b) < 1e-12;
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function select(id, notify = true) {
    if (!state) return;
    selectedId = id;
    renderDetail();
    document.querySelectorAll('[data-centrality-id]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.centralityId === id)));
    if (notify) state.onSelect(id);
  }

  function renderDetail() {
    const panel = $('centrality-detail');
    const node = state.nodes.find(n => n.id === selectedId);
    panel.hidden = !node;
    if (!node) return;
    const score = state.analysis.byId.get(node.id);
    panel.innerHTML = `<h3>${escapeHtml(name(node))}</h3><p class="centrality-note">${node.type === 'person' ? escapeHtml(`${node.role} · ${node.disc}`) : 'Affiliation group'}</p>
      <dl><dt>Direct connections</dt><dd>${score.degree}</dd><dt>Normalized degree</dt><dd>${percent(score.degreeNormalized)}</dd><dt>Betweenness</dt><dd>${percent(score.betweenness)}</dd><dt>Harmonic</dt><dd>${percent(score.harmonic)}</dd><dt>Reachable other nodes</dt><dd>${score.reachable} / ${state.analysis.nodeCount - 1}</dd></dl>`;
  }

  function render() {
    if (!state) return;
    const metric = $('centrality-metric').value;
    const scope = $('centrality-scope').value;
    const query = $('centrality-filter').value.trim().toLowerCase();
    const candidates = state.nodes.filter(n => n.type === scope).map(node => ({ node, score: state.analysis.byId.get(node.id) }));
    candidates.sort((a, b) => equalScore(a.score[metric], b.score[metric]) ? name(a.node).localeCompare(name(b.node), 'en') : b.score[metric] - a.score[metric]);
    let rank = 1;
    candidates.forEach((row, i) => {
      if (i && !equalScore(row.score[metric], candidates[i - 1].score[metric])) rank = i + 1;
      row.rank = rank;
    });
    const visible = candidates.filter(({ node }) => [name(node), node.role, node.disc, node.country, ...(node.projects || [])].filter(Boolean).join(' ').toLowerCase().includes(query));
    $('centrality-description').textContent = metrics[metric].explanation;
    $('centrality-score-heading').textContent = metrics[metric].label;
    $('centrality-count').textContent = `${visible.length} of ${candidates.length} ${scope === 'person' ? 'people' : 'groups'} · equal scores share a rank`;
    const max = candidates.length ? candidates[0].score[metric] : 0;
    $('centrality-rows').innerHTML = visible.length ? visible.map(({ node, score, rank }) => `<tr>
      <td class="number">${rank}</td><td><button type="button" data-centrality-id="${escapeHtml(node.id)}" aria-pressed="${node.id === selectedId}">${escapeHtml(name(node))}</button><div class="centrality-scorebar" aria-hidden="true"><span style="width:${max ? 100 * score[metric] / max : 0}%"></span></div></td>
      <td class="number">${percent(score[metric])}${metric === 'degreeNormalized' ? `<br><small>${score.degree} links</small>` : ''}</td></tr>`).join('') : '<tr><td colspan="3">No matching nodes.</td></tr>';
    const scopeScores = candidates.map(row => row.score[metric]);
    const allEqual = scopeScores.length > 1 && scopeScores.every(score => equalScore(score, scopeScores[0]));
    const context = scope === 'person' && state.type !== 'project'
      ? 'Each person has one affiliation in this view, so all people have degree 1 and betweenness 0. Harmonic scores reflect the size of their connected group.'
      : state.type === 'project'
        ? 'P1 is disconnected from P2/P3 in the recorded data. People affiliated with both P2 and P3 bridge those two projects; all 13 share the same structural scores.'
        : 'Disconnected groups cannot reach one another. Compare groups within this view; group size strongly affects these scores.';
    $('centrality-context').textContent = context + (allEqual ? ` All ${candidates.length} ${scope === 'person' ? 'people' : 'groups'} tie on this measure.` : '');
    renderDetail();
    const sizePeople = $('centrality-size').checked;
    const metricKey = `${metric}:${sizePeople}`;
    if (appliedMetric !== metricKey) {
      state.onMetric(metric, sizePeople, state.analysis);
      appliedMetric = metricKey;
    }
  }

  function exportCsv() {
    if (!state) return;
    const fields = ['network', 'id', 'name', 'node_type', 'degree', 'degree_normalized', 'betweenness_normalized', 'harmonic_normalized', 'reachable_other_nodes', 'component_size', 'total_nodes', 'total_edges'];
    const rows = state.nodes.map(node => {
      const s = state.analysis.byId.get(node.id);
      return [state.type, node.id, name(node), node.type, s.degree, s.degreeNormalized, s.betweenness, s.harmonic, s.reachable, s.componentSize, state.analysis.nodeCount, state.analysis.edgeCount];
    });
    const quote = value => `"${String(value).replace(/"/g, '""')}"`;
    const csv = [fields, ...rows].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `cornell-${state.type}-centrality.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  ['centrality-metric', 'centrality-scope', 'centrality-size'].forEach(id => $(id).addEventListener('change', render));
  $('centrality-filter').addEventListener('input', render);
  $('centrality-export').addEventListener('click', exportCsv);
  $('centrality-rows').addEventListener('click', event => {
    const button = event.target.closest('[data-centrality-id]');
    if (button) select(button.dataset.centralityId);
  });

  window.CornellCentralityPanel = {
    update(next) {
      const changed = !state || state.type !== next.type;
      state = { ...next, analysis: CornellCentrality.analyze(next.nodes, next.links) };
      appliedMetric = null;
      if (changed) { selectedId = null; $('centrality-filter').value = ''; }
      const a = state.analysis;
      $('centrality-people').textContent = a.personCount;
      $('centrality-groups').textContent = a.hubCount;
      $('centrality-components').textContent = a.componentCount;
      $('centrality-network-name').textContent = { project: 'Project affiliations', field: 'Discipline affiliations', country: 'State affiliations' }[next.type];
      $('centrality-graph-count').textContent = `${a.nodeCount} nodes · ${a.edgeCount} undirected links. Scores always use the complete selected network; search only filters the display.`;
      render();
      if (selectedId) state.onSelect(selectedId);
    },
    select
  };
}());
