/**
 * app.js — UI controller for the NFA → DFA Converter.
 *
 * Flow: User Input (tab 1) → Algorithm (Automata.subsetConstruction)
 *       → Step-by-step visualisation (tab 2) → Result (tab 3)
 *       → Simulation (tab 4) → Validation (tab 5)
 *
 * All algorithmic work is delegated to js/automata.js; this file only reads
 * the form, calls the algorithms and renders tables, text and diagrams.
 */
(function () {
  'use strict';
  const A = window.Automata;
  const PRESETS = window.Presets;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const setText = (arr) => esc(A.setLabel(arr));

  // ------------------------------------------------------------------ state
  const S = {
    nfa: null, // validated NFA used for the current conversion
    conv: null, // { dfa, dStates, steps, edgeOrder }
    min: null, // minimisation result
    step: 0,
    stepTimer: null,
    sim: null,
    simPos: 0,
    simTimer: null,
    tests: [], // [{ input, expected }]
    cells: {}, // transition-table cell text: cells[state][symbol]
    version: 0, // bumps on every conversion → resets diagram layouts
    dirty: false, // definition edited after last conversion
  };

  const views = {
    preview: new GraphView($('#nfaPreview')),
    stepNfa: new GraphView($('#stepNfa')),
    stepDfa: new GraphView($('#stepDfa')),
    dfa: new GraphView($('#dfaGraph')),
    min: new GraphView($('#minGraph')),
    simNfa: new GraphView($('#simNfa')),
    simDfa: new GraphView($('#simDfa')),
  };

  // ------------------------------------------------------------------ helpers
  function msg(kind, html) {
    return `<div class="msg ${kind}">${html}</div>`;
  }
  function msgList(kind, title, items) {
    return msg(kind, `<b>${title}</b><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`);
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }
  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  /** Graph data for an NFA (every δ entry becomes an edge). */
  function nfaGraph(nfa, extra) {
    const edges = [];
    for (const s of nfa.states)
      for (const sym of Object.keys(nfa.delta[s])) for (const t of nfa.delta[s][sym]) edges.push({ from: s, to: t, symbol: sym });
    return Object.assign({ states: nfa.states, start: nfa.start, finals: nfa.finals, edges, layoutKey: 'nfa' + S.version }, extra || {});
  }

  /** Graph data for a DFA, with each state's NFA subset as a subtitle. */
  function dfaGraph(dfa, extra, key) {
    const edges = [];
    for (const s of dfa.states) for (const a of dfa.alphabet) if (dfa.delta[s] && dfa.delta[s][a] !== undefined) edges.push({ from: s, to: dfa.delta[s][a], symbol: a });
    const subtitles = {};
    if (dfa.sets) for (const s of dfa.states) subtitles[s] = Array.isArray(dfa.sets[s]) ? A.setLabel(dfa.sets[s]) : '';
    return Object.assign(
      { states: dfa.states, start: dfa.start, finals: dfa.finals, edges, subtitles, dead: new Set(dfa.dead || []), layoutKey: (key || 'dfa') + S.version },
      extra || {}
    );
  }

  /** NFA edges used when going from set T on symbol a, plus the ε-edges of the closure. */
  function nfaStepEdges(nfa, fromSet, sym, trace) {
    const keys = new Set();
    if (sym) for (const s of fromSet) for (const t of nfa.delta[s][sym] || []) keys.add(s + '|' + t);
    for (const [s, t] of trace || []) keys.add(s + '|' + t);
    return keys;
  }

  // ------------------------------------------------------------------ tabs
  function showTab(name) {
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
    window.scrollTo(0, 0);
    // SVGs inside hidden panels cannot be measured, so redraw on show.
    if (name === 'define') renderPreview();
    if (!S.conv) return;
    if (name === 'steps') renderStep();
    if (name === 'result') renderResult();
    if (name === 'simulate') renderSim();
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  function updateConversionGate() {
    const notice = S.conv
      ? ''
      : msg('info', 'Define an NFA in tab <b>1 · Define NFA</b> and press <b>Convert to DFA →</b> first.');
    $$('.needs-conversion').forEach((n) => (n.innerHTML = notice));
    $$('.conv-only').forEach((n) => n.classList.toggle('hidden', !S.conv));
  }

  // ================================================================== 1. DEFINE
  function populatePresets() {
    $('#presetSelect').innerHTML = PRESETS.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    const showDesc = () => {
      const p = PRESETS.find((x) => x.id === $('#presetSelect').value);
      $('#presetDesc').textContent = p ? p.description : '';
    };
    $('#presetSelect').addEventListener('change', showDesc);
    showDesc();
  }

  function loadDefinition(def, tests) {
    const list = (v) => A.parseList(v).join(', ');
    $('#inStates').value = list(def.states);
    $('#inAlphabet').value = list(def.alphabet);
    $('#inStart').value = def.start || '';
    $('#inFinals').value = list(def.finals);
    S.cells = {};
    const put = (from, sym, to) => {
      sym = A.isEpsilon(sym) ? A.EPSILON : String(sym);
      S.cells[from] = S.cells[from] || {};
      const cur = A.parseList(S.cells[from][sym] || '');
      for (const t of A.parseList(to)) if (!cur.includes(t)) cur.push(t);
      S.cells[from][sym] = cur.join(', ');
    };
    const t = def.transitions || {};
    if (Array.isArray(t)) t.forEach((tr) => put(tr[0], tr[1], tr[2]));
    else for (const from of Object.keys(t)) for (const sym of Object.keys(t[from])) put(from, sym, t[from][sym]);
    if (tests) S.tests = tests.map(([input, expected]) => ({ input, expected }));
    buildDeltaTable();
    onDefinitionChanged();
  }

  function readCells() {
    $$('#deltaTable input').forEach((inp) => {
      S.cells[inp.dataset.state] = S.cells[inp.dataset.state] || {};
      S.cells[inp.dataset.state][inp.dataset.sym] = inp.value;
    });
  }

  /** (Re)build the δ table from Q and Σ, keeping whatever the user already typed. */
  function buildDeltaTable() {
    readCells();
    const states = A.parseList($('#inStates').value);
    const alphabet = A.parseList($('#inAlphabet').value).filter((a) => !A.isEpsilon(a));
    const cols = [...alphabet, A.EPSILON];
    const table = $('#deltaTable');
    if (!states.length || !alphabet.length) {
      table.innerHTML = `<tr><td class="muted">Enter Q and Σ to get a transition table.</td></tr>`;
      return;
    }
    let html = `<thead><tr><th>δ</th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>`;
    for (const s of states) {
      html += `<tr><th class="state" data-state-head="${esc(s)}"></th>`;
      for (const c of cols) {
        const v = (S.cells[s] && S.cells[s][c]) || '';
        html += `<td><input data-state="${esc(s)}" data-sym="${esc(c)}" value="${esc(v)}" placeholder="∅" spellcheck="false" /></td>`;
      }
      html += '</tr>';
    }
    table.innerHTML = html + '</tbody>';
    updateRowMarkers();
  }

  function updateRowMarkers() {
    const start = $('#inStart').value.trim();
    const finals = new Set(A.parseList($('#inFinals').value));
    $$('#deltaTable [data-state-head]').forEach((th) => {
      const s = th.dataset.stateHead;
      th.textContent = (s === start ? '→ ' : '') + (finals.has(s) ? '* ' : '') + s;
    });
  }

  function readDefinition() {
    readCells();
    const states = A.parseList($('#inStates').value);
    const alphabet = A.parseList($('#inAlphabet').value);
    const syms = [...alphabet.filter((a) => !A.isEpsilon(a)), A.EPSILON];
    const transitions = {};
    for (const s of states) {
      for (const sym of syms) {
        const targets = A.parseList((S.cells[s] && S.cells[s][sym]) || '');
        if (targets.length) (transitions[s] = transitions[s] || {})[sym] = targets;
      }
    }
    return { states, alphabet, start: $('#inStart').value.trim(), finals: A.parseList($('#inFinals').value), transitions };
  }

  function renderPreview() {
    const res = A.buildNFA(readDefinition());
    const known = new Set(A.parseList($('#inStates').value));
    $$('#deltaTable input').forEach((inp) => inp.classList.toggle('invalid', A.parseList(inp.value).some((t) => !known.has(t))));
    let html = '';
    if (res.errors.length) html += msgList('error', 'Please fix the definition:', res.errors);
    if (res.warnings.length) html += msgList('warn', 'Warnings:', res.warnings);
    if (!res.errors.length) {
      const n = res.nfa;
      const tCount = n.states.reduce((acc, s) => acc + Object.values(n.delta[s]).reduce((x, a) => x + a.length, 0), 0);
      html += msg('ok', `Valid ${n.hasEpsilon ? 'ε-NFA' : 'NFA'}: |Q| = ${n.states.length}, |Σ| = ${n.alphabet.length}, ${tCount} transition(s). Worst case DFA size 2<sup>${n.states.length}</sup> = ${2 ** n.states.length}.`);
    }
    if (S.dirty && S.conv) html += msg('info', 'The definition changed since the last conversion — press <b>Convert to DFA →</b> to update the other tabs.');
    $('#defineMessages').innerHTML = html;
    if (res.nfa) views.preview.render(nfaGraph(res.nfa, { layoutKey: 'preview:' + res.nfa.states.join(',') }));
    else views.preview.render({ states: [], edges: [], finals: [], emptyText: 'Fix the errors to see the diagram' });
    return res;
  }

  function onDefinitionChanged() {
    if (S.conv) S.dirty = true;
    renderPreview();
  }

  const rebuild = debounce(() => {
    buildDeltaTable();
    onDefinitionChanged();
  }, 250);
  $('#inStates').addEventListener('input', rebuild);
  $('#inAlphabet').addEventListener('input', rebuild);
  ['#inStart', '#inFinals'].forEach((id) =>
    $(id).addEventListener('input', debounce(() => {
      updateRowMarkers();
      onDefinitionChanged();
    }, 200))
  );
  $('#deltaTable').addEventListener('input', debounce(onDefinitionChanged, 250));

  $('#loadPreset').addEventListener('click', () => {
    const p = PRESETS.find((x) => x.id === $('#presetSelect').value);
    if (p) loadDefinition(p.definition, p.tests);
  });
  $('#clearAll').addEventListener('click', () => {
    loadDefinition({ states: 'q0, q1', alphabet: 'a, b', start: 'q0', finals: 'q1', transitions: {} }, []);
  });
  $('#exportJson').addEventListener('click', () => {
    $('#jsonBox').value = JSON.stringify(readDefinition(), null, 2);
  });
  $('#importJson').addEventListener('click', () => {
    try {
      const def = JSON.parse($('#jsonBox').value);
      loadDefinition(def, Array.isArray(def.tests) ? def.tests : []);
    } catch (e) {
      $('#defineMessages').innerHTML = msg('error', 'Invalid JSON: ' + esc(e.message));
    }
  });

  $('#convertBtn').addEventListener('click', convert);

  function convert() {
    const res = renderPreview();
    if (!res.nfa) return;
    try {
      S.conv = A.subsetConstruction(res.nfa, { includeDeadState: $('#optDead').checked });
    } catch (e) {
      $('#defineMessages').innerHTML += msg('error', esc(e.message));
      return;
    }
    S.nfa = res.nfa;
    S.min = null;
    S.step = 0;
    S.sim = null;
    S.dirty = false;
    S.version++;
    stopStepPlay();
    stopSimPlay();
    $('#stepSlider').max = S.conv.steps.length - 1;
    $('#minOut').classList.add('hidden');
    $('#tcSummary').innerHTML = '';
    $('#exOut').innerHTML = '';
    $('#eqOut').innerHTML = '';
    $('#simVerdict').innerHTML = '';
    updateConversionGate();
    renderTests();
    showTab('steps');
  }

  // ================================================================== 2. STEPS
  function explainStep(step, conv) {
    const sym = (a) => `<b>${esc(a)}</b>`;
    const traceText = (trace) =>
      trace && trace.length ? `<div class="small muted">ε-moves followed: ${trace.map(([s, t]) => `${esc(s)} –ε→ ${esc(t)}`).join(', ')}</div>` : '';
    const total = conv.dStates.length;
    switch (step.type) {
      case 'start':
        return `<div class="title">Initialisation — the DFA start state</div>
          The DFA starts in every NFA state reachable from q₀ = ${esc(step.of[0])} without reading input:
          <div class="formula">A = ε-closure({${esc(step.of[0])}}) = ${setText(step.closure)}</div>${traceText(step.trace)}
          <span class="tag new">A</span> is added to Dstates as <em>unmarked</em>.`;
      case 'mark':
        return `<div class="title">Mark ${esc(step.state)} = ${setText(step.set)}</div>
          ${esc(step.state)} is the next unmarked state. We now compute its transition on every symbol of Σ = {${conv.dfa.alphabet.map(esc).join(', ')}}.`;
      case 'transition': {
        const target = step.to
          ? step.isNew
            ? `<span class="tag new">${esc(step.to)}</span> — a <b>new</b> subset, added to Dstates (unmarked).`
            : `<span class="tag old">${esc(step.to)}</span> — this subset already exists, so no new state is created.`
          : `∅ — the empty set. The dead state is disabled, so this transition is left undefined (reject).`;
        return `<div class="title">Dtran[${esc(step.from)}, ${esc(step.symbol)}]</div>
          <div class="formula">move(${esc(step.from)}, ${esc(step.symbol)}) = move(${setText(step.fromSet)}, ${esc(step.symbol)}) = ${setText(step.move)}
ε-closure(${setText(step.move)}) = ${setText(step.closure)}</div>${traceText(step.trace)}
          On ${sym(step.symbol)}, ${esc(step.from)} goes to ${target}
          ${step.to && step.closure.length === 0 ? '<div class="small muted">The ∅ state is a dead/trap state: every symbol loops back to it and it is never accepting.</div>' : ''}`;
      }
      case 'done': {
        const acc = conv.dStates.filter((s) => s.accepting);
        return `<div class="title">Finished — no unmarked states remain</div>
          The DFA has <b>${total}</b> state(s) (upper bound 2<sup>${S.nfa.states.length}</sup> = ${2 ** S.nfa.states.length}).
          A DFA state is accepting iff its subset contains an NFA final state (F = ${setText(S.nfa.finals)}):
          <div class="formula">F' = {${acc.map((s) => `${esc(s.id)}`).join(', ')}}${acc.length ? '   ← ' + acc.map((s) => `${esc(s.id)} = ${setText(s.set)}`).join(', ') : '   (no accepting states: L = ∅)'}</div>`;
      }
    }
    return '';
  }

  function renderStep() {
    if (!S.conv) return;
    const conv = S.conv;
    const k = Math.max(0, Math.min(S.step, conv.steps.length - 1));
    S.step = k;
    const step = conv.steps[k];
    $('#stepSlider').value = k;
    const labels = { start: 'initialise', mark: 'mark state', transition: 'compute transition', done: 'finished' };
    $('#stepCounter').textContent = `Step ${k} / ${conv.steps.length - 1} · ${labels[step.type]}`;
    $('#stepExplain').innerHTML = explainStep(step, conv);

    // --- NFA highlighting
    let nfaHl = new Set();
    let nfaSec = new Set();
    let nfaEdges = new Set();
    if (step.type === 'start') {
      nfaHl = new Set(step.closure);
      nfaSec = new Set(step.of);
      nfaEdges = nfaStepEdges(S.nfa, [], null, step.trace);
    } else if (step.type === 'mark') {
      nfaSec = new Set(step.set);
    } else if (step.type === 'transition') {
      nfaSec = new Set(step.fromSet);
      nfaHl = new Set(step.closure);
      nfaEdges = nfaStepEdges(S.nfa, step.fromSet, step.symbol, step.trace);
    }
    views.stepNfa.render(nfaGraph(S.nfa, { highlight: nfaHl, secondary: nfaSec, highlightEdges: nfaEdges }));

    // --- partial DFA
    const visible = conv.dStates.slice(0, step.nStates);
    const edges = conv.edgeOrder.slice(0, step.nEdges);
    const full = dfaGraph(conv.dfa);
    let hl = new Set();
    let fresh = new Set();
    let hlEdges = new Set();
    if (step.type === 'start') {
      hl = new Set([step.to]);
      fresh = hl;
    } else if (step.type === 'mark') hl = new Set([step.state]);
    else if (step.type === 'transition' && step.to) {
      hl = new Set([step.to]);
      if (step.isNew) fresh = new Set([step.to]);
      hlEdges = new Set([step.from + '|' + step.to]);
    } else if (step.type === 'done') hl = new Set(conv.dfa.finals);
    const visIds = visible.map((s) => s.id);
    views.stepDfa.render({
      states: visIds,
      start: conv.dfa.start,
      finals: visible.filter((s) => s.accepting).map((s) => s.id),
      edges: edges.map((e) => ({ from: e.from, to: e.to, symbol: e.symbol })),
      subtitles: full.subtitles,
      dead: full.dead,
      layout: full,
      layoutKey: full.layoutKey,
      highlight: hl,
      fresh,
      highlightEdges: hlEdges,
    });

    // --- subset table
    const alphabet = conv.dfa.alphabet;
    const known = {};
    edges.forEach((e) => ((known[e.from] = known[e.from] || {})[e.symbol] = e.to));
    const currentRow = step.type === 'transition' ? step.from : step.type === 'mark' ? step.state : step.type === 'start' ? step.to : null;
    let html = `<thead><tr><th>DFA state</th><th>NFA subset</th>${alphabet.map((a) => `<th>${esc(a)}</th>`).join('')}<th>Accepting?</th><th>Status</th></tr></thead><tbody>`;
    visible.forEach((st, i) => {
      const marked = i < step.nMarked;
      // rows before the current one are fully processed; a missing entry there means "no transition"
      const finished = marked && (i < step.nMarked - 1 || step.type === 'done');
      const cls = [st.id === currentRow ? 'current' : '', marked ? 'marked' : ''].join(' ');
      html += `<tr class="${cls}"><td><b>${st.id === conv.dfa.start ? '→ ' : ''}${esc(st.id)}</b></td><td class="set">${setText(st.set)}</td>`;
      for (const a of alphabet) {
        const t = known[st.id] && known[st.id][a];
        const isFresh = step.type === 'transition' && step.from === st.id && step.symbol === a;
        if (t !== undefined) html += `<td class="${isFresh ? 'fresh' : ''}">${esc(t)}</td>`;
        else if (isFresh) html += `<td class="fresh">—</td>`;
        else if (finished) html += `<td class="pending">—</td>`;
        else html += `<td class="pending">${marked ? '…' : ''}</td>`;
      }
      html += `<td>${st.accepting ? '<span class="yes">yes</span>' : 'no'}</td><td class="small">${marked ? 'marked ✓' : 'unmarked'}</td></tr>`;
    });
    $('#subsetTable').innerHTML = html + '</tbody>';
  }

  function stopStepPlay() {
    clearInterval(S.stepTimer);
    S.stepTimer = null;
    $('#playSteps').textContent = '▶ Play';
  }
  function gotoStep(k) {
    S.step = k;
    renderStep();
  }
  $$('[data-step]').forEach((b) =>
    b.addEventListener('click', () => {
      stopStepPlay();
      const last = S.conv ? S.conv.steps.length - 1 : 0;
      const map = { first: 0, prev: S.step - 1, next: S.step + 1, last };
      gotoStep(Math.max(0, Math.min(last, map[b.dataset.step])));
    })
  );
  $('#stepSlider').addEventListener('input', (e) => {
    stopStepPlay();
    gotoStep(Number(e.target.value));
  });
  $('#playSteps').addEventListener('click', () => {
    if (S.stepTimer) return stopStepPlay();
    if (!S.conv) return;
    if (S.step >= S.conv.steps.length - 1) gotoStep(0);
    $('#playSteps').textContent = '⏸ Pause';
    const tick = () => {
      if (S.step >= S.conv.steps.length - 1) return stopStepPlay();
      gotoStep(S.step + 1);
    };
    S.stepTimer = setInterval(tick, 2700 - Number($('#stepSpeed').value));
  });
  $('#stepSpeed').addEventListener('change', () => {
    if (S.stepTimer) {
      stopStepPlay();
      $('#playSteps').click();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (!$('#tab-steps').classList.contains('active') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (e.key === 'ArrowRight') $('[data-step="next"]').click();
    if (e.key === 'ArrowLeft') $('[data-step="prev"]').click();
  });

  // ================================================================== 3. RESULT
  function dfaTableHTML(dfa, setCaption) {
    const finals = new Set(dfa.finals);
    let html = `<thead><tr><th>State</th><th>${setCaption}</th>${dfa.alphabet.map((a) => `<th>${esc(a)}</th>`).join('')}</tr></thead><tbody>`;
    for (const s of dfa.states) {
      const mark = (s === dfa.start ? '→ ' : '') + (finals.has(s) ? '* ' : '');
      const set = dfa.sets && dfa.sets[s] ? (setCaption === 'NFA subset' ? A.setLabel(dfa.sets[s]) : '{' + dfa.sets[s].join(', ') + '}') : '';
      html += `<tr><td><b>${esc(mark + s)}</b></td><td class="set">${esc(set)}</td>`;
      for (const a of dfa.alphabet) {
        const t = dfa.delta[s] && dfa.delta[s][a];
        html += `<td>${t === undefined ? '<span class="muted">—</span>' : esc(t)}</td>`;
      }
      html += '</tr>';
    }
    return html + '</tbody>';
  }

  function renderResult() {
    if (!S.conv) return;
    const { dfa, dStates } = S.conv;
    const nfa = S.nfa;
    const edgeCount = dfa.states.reduce((n, s) => n + Object.keys(dfa.delta[s]).length, 0);
    const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
    $('#resultStats').innerHTML =
      stat(nfa.states.length, `NFA states${nfa.hasEpsilon ? ' (ε-NFA)' : ''}`) +
      stat(dfa.states.length, 'DFA states') +
      stat(2 ** nfa.states.length, 'theoretical upper bound 2ⁿ') +
      stat(dfa.finals.length, 'accepting DFA states') +
      stat(edgeCount, 'DFA transitions') +
      stat(dfa.dead.length ? 'yes' : 'no', 'dead state ∅ present');
    views.dfa.render(dfaGraph(dfa));
    $('#dfaTable').innerHTML = dfaTableHTML(dfa, 'NFA subset');
    const startSet = dStates[0].set;
    $('#dfaFormal').textContent =
      `D = (Q', Σ, δ', ${dfa.start}, F')\n` +
      `Q' = {${dfa.states.join(', ')}}\n` +
      `Σ  = {${dfa.alphabet.join(', ')}}\n` +
      `q0' = ${dfa.start} = ε-closure({${nfa.start}}) = ${A.setLabel(startSet)}\n` +
      `F' = {${dfa.finals.join(', ')}}   (subsets that contain a state of F = ${A.setLabel(nfa.finals)})\n` +
      `δ'(T, a) = ε-closure(move(T, a))`;
    if (S.min) renderMin();
  }

  function renderMin() {
    const m = S.min;
    const before = S.conv.dfa.states.length;
    const merged = m.dfa.states.filter((s) => m.dfa.sets[s].length > 1);
    let summary = `<div class="title">Minimal DFA: ${m.dfa.states.length} state(s) (generated DFA had ${before}).</div>`;
    summary += merged.length
      ? `Equivalent states merged: ${merged.map((s) => `<b>{${m.dfa.sets[s].map(esc).join(', ')}}</b>`).join(', ')}.`
      : 'No two states are equivalent — the subset-construction DFA is already minimal.';
    if (m.trapAdded) summary += ' A trap state ∅ was added first to make the DFA complete.';
    if (m.removed.length) summary += ` Unreachable states removed: ${m.removed.map(esc).join(', ')}.`;
    $('#minSummary').innerHTML = summary;
    let html = '<thead><tr><th>Round</th><th>Partition</th><th>#Groups</th></tr></thead><tbody>';
    m.rounds.forEach((r, i) => {
      const note = i === 0 ? ' <span class="muted small">(accepting vs non-accepting)</span>' : i === m.rounds.length - 1 ? ' <span class="muted small">(stable)</span>' : '';
      html += `<tr><td>P${r.round}</td><td class="set">${r.groups.map((g) => '{' + g.map(esc).join(', ') + '}').join('  ')}${note}</td><td>${r.groups.length}</td></tr>`;
    });
    $('#minRounds').innerHTML = html + '</tbody>';
    $('#minTable').innerHTML = dfaTableHTML(m.dfa, 'Merged DFA states');
    const g = dfaGraph(m.dfa, {}, 'min');
    for (const s of m.dfa.states) g.subtitles[s] = '';
    views.min.render(g);
  }

  $('#minimizeBtn').addEventListener('click', () => {
    if (!S.conv) return;
    S.min = A.minimizeDFA(S.conv.dfa);
    $('#minOut').classList.remove('hidden');
    renderMin();
  });
  $('#dlDfaSvg').addEventListener('click', () => download('dfa.svg', views.dfa.toSVGString(), 'image/svg+xml'));
  $('#dlDfaJson').addEventListener('click', () => {
    if (S.conv) download('dfa.json', JSON.stringify(A.toDefinition(S.conv.dfa, true), null, 2), 'application/json');
  });

  // ================================================================== 4. SIMULATE
  function runSimulation() {
    if (!S.conv) return;
    stopSimPlay();
    const tok = A.tokenize(S.nfa.alphabet, $('#simInput').value);
    if (tok.error) {
      S.sim = null;
      $('#simVerdict').innerHTML = msg('error', esc(tok.error) + ` — Σ = {${S.nfa.alphabet.map(esc).join(', ')}}`);
      renderSim();
      return;
    }
    S.sim = { symbols: tok.symbols, n: A.simulateNFA(S.nfa, tok.symbols), d: A.simulateDFA(S.conv.dfa, tok.symbols) };
    S.simPos = 0;
    renderSim();
  }

  function renderSim() {
    if (!S.conv) return;
    const sim = S.sim;
    const dfa = S.conv.dfa;
    if (!sim) {
      $('#simTape').innerHTML = '';
      $('#simNfaTrace').innerHTML = '';
      $('#simDfaTrace').innerHTML = '';
      views.simNfa.render(nfaGraph(S.nfa));
      views.simDfa.render(dfaGraph(dfa));
      return;
    }
    const pos = S.simPos;
    const syms = sim.symbols;
    $('#simTape').innerHTML = syms.length
      ? syms.map((s, i) => `<span class="cell ${i < pos - 1 ? 'done' : i === pos - 1 ? 'cur' : ''}">${esc(s)}</span>`).join('')
      : '<span class="cell eps">ε</span>';

    const nCur = sim.n.trace[pos];
    const nPrev = pos > 0 ? sim.n.trace[pos - 1] : null;
    let nEdges = new Set();
    if (nPrev) {
      for (const s of nPrev.states) for (const t of S.nfa.delta[s][nCur.symbol] || []) nEdges.add(s + '|' + t);
      const cl = A.epsilonClosure(S.nfa, nCur.move);
      cl.trace.forEach(([s, t]) => nEdges.add(s + '|' + t));
    } else A.epsilonClosure(S.nfa, [S.nfa.start]).trace.forEach(([s, t]) => nEdges.add(s + '|' + t));
    views.simNfa.render(nfaGraph(S.nfa, { highlight: new Set(nCur.states), highlightEdges: nEdges }));

    const dCur = sim.d.trace[pos];
    const dPrev = pos > 0 ? sim.d.trace[pos - 1] : null;
    views.simDfa.render(
      dfaGraph(dfa, {
        highlight: new Set(dCur.state === null ? [] : [dCur.state]),
        highlightEdges: new Set(dPrev && dPrev.state !== null && dCur.state !== null ? [dPrev.state + '|' + dCur.state] : []),
      })
    );

    const nFinals = new Set(S.nfa.finals);
    let nh = '<thead><tr><th>Step</th><th>Read</th><th>move</th><th>Active NFA states (after ε-closure)</th></tr></thead><tbody>';
    sim.n.trace.forEach((t, i) => {
      const acc = t.states.some((s) => nFinals.has(s));
      nh += `<tr class="${i === pos ? 'current' : ''}"><td>${i}</td><td>${t.symbol === null ? '—' : esc(t.symbol)}</td><td class="set">${t.move ? setText(t.move) : '—'}</td><td class="set">${setText(t.states)}${acc ? ' <span class="yes">∋ final</span>' : ''}</td></tr>`;
    });
    $('#simNfaTrace').innerHTML = nh + '</tbody>';
    const dFinals = new Set(dfa.finals);
    let dh = '<thead><tr><th>Step</th><th>Read</th><th>DFA state</th><th>= NFA subset</th></tr></thead><tbody>';
    sim.d.trace.forEach((t, i) => {
      const name = t.state === null ? '— (no transition)' : esc(t.state) + (dFinals.has(t.state) ? ' <span class="yes">accepting</span>' : '');
      dh += `<tr class="${i === pos ? 'current' : ''}"><td>${i}</td><td>${t.symbol === null ? '—' : esc(t.symbol)}</td><td>${name}</td><td class="set">${t.state === null ? '∅' : setText(dfa.sets[t.state])}</td></tr>`;
    });
    $('#simDfaTrace').innerHTML = dh + '</tbody>';

    const word = esc(A.formatString(syms, S.nfa.alphabet));
    const v = (b) => (b ? '<span class="yes">ACCEPTED</span>' : '<span class="no">REJECTED</span>');
    const agree = sim.n.accepted === sim.d.accepted;
    const nWhy = sim.n.accepted ? `final set ${setText(sim.n.final)} contains a final state` : `final set ${setText(sim.n.final)} contains no final state`;
    const dWhy = sim.d.final === null ? 'got stuck (missing transition)' : `ended in ${esc(sim.d.final)}, ${dFinals.has(sim.d.final) ? 'an accepting' : 'a non-accepting'} state`;
    $('#simVerdict').innerHTML =
      msg(agree ? (sim.n.accepted ? 'ok' : 'warn') : 'error', `Input "<b class="mono">${word}</b>" — NFA: ${v(sim.n.accepted)} (${nWhy}) · DFA: ${v(sim.d.accepted)} (${dWhy}) · ${agree ? '✓ both automata agree' : '✗ MISMATCH'}`) +
      (pos < syms.length ? msg('info', `Showing step ${pos} of ${syms.length} — use ▶ to step through the input.`) : '');
  }

  function stopSimPlay() {
    clearInterval(S.simTimer);
    S.simTimer = null;
    $('#simPlay').textContent = '▶ Play';
  }
  $('#simRun').addEventListener('click', () => {
    runSimulation();
    if (S.sim) {
      S.simPos = S.sim.symbols.length;
      renderSim();
    }
  });
  $('#simInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('#simRun').click());
  $$('[data-sim]').forEach((b) =>
    b.addEventListener('click', () => {
      if (!S.sim) runSimulation();
      if (!S.sim) return;
      stopSimPlay();
      const n = S.sim.symbols.length;
      const map = { first: 0, prev: S.simPos - 1, next: S.simPos + 1, last: n };
      S.simPos = Math.max(0, Math.min(n, map[b.dataset.sim]));
      renderSim();
    })
  );
  $('#simPlay').addEventListener('click', () => {
    if (S.simTimer) return stopSimPlay();
    runSimulation();
    if (!S.sim) return;
    $('#simPlay').textContent = '⏸ Pause';
    S.simTimer = setInterval(() => {
      if (S.simPos >= S.sim.symbols.length) return stopSimPlay();
      S.simPos++;
      renderSim();
    }, 900);
  });

  // ================================================================== 5. VALIDATE
  function renderTests(results) {
    const showMin = !!S.min;
    let html = `<thead><tr><th>#</th><th>Input string</th><th>Expected</th><th>NFA</th><th>DFA</th>${showMin ? '<th>Min DFA</th>' : ''}<th>Verdict</th><th></th></tr></thead><tbody>`;
    if (!S.tests.length) html += `<tr><td colspan="8" class="muted">No test cases yet — add some or load the example's tests.</td></tr>`;
    const out = (b) => (b === undefined ? '' : b ? '<span class="yes">accept</span>' : '<span class="no">reject</span>');
    S.tests.forEach((t, i) => {
      const r = results && results[i];
      const verdict = !r ? '' : r.error ? `<span class="badge fail" title="${esc(r.error)}">INVALID</span>` : r.pass ? '<span class="badge pass">PASS</span>' : '<span class="badge fail">FAIL</span>';
      html += `<tr><td>${i + 1}</td>
        <td><input class="tc" data-i="${i}" value="${esc(t.input)}" placeholder="ε" spellcheck="false" /></td>
        <td><select data-i="${i}"><option value="1" ${t.expected ? 'selected' : ''}>Accept</option><option value="0" ${t.expected ? '' : 'selected'}>Reject</option></select></td>
        <td>${r && !r.error ? out(r.n) : ''}</td><td>${r && !r.error ? out(r.d) : ''}</td>${showMin ? `<td>${r && !r.error ? out(r.m) : ''}</td>` : ''}
        <td>${verdict}</td><td><button class="btn ghost small" data-del="${i}" title="Remove">✕</button></td></tr>`;
    });
    $('#tcTable').innerHTML = html + '</tbody>';
  }

  $('#tcTable').addEventListener('input', (e) => {
    const i = Number(e.target.dataset.i);
    if (e.target.matches('input.tc')) S.tests[i].input = e.target.value;
  });
  $('#tcTable').addEventListener('change', (e) => {
    const i = Number(e.target.dataset.i);
    if (e.target.matches('select')) S.tests[i].expected = e.target.value === '1';
  });
  $('#tcTable').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    S.tests.splice(Number(b.dataset.del), 1);
    renderTests();
  });
  $('#tcAdd').addEventListener('click', () => {
    S.tests.push({ input: '', expected: true });
    renderTests();
    const inputs = $$('#tcTable input.tc');
    inputs[inputs.length - 1].focus();
  });
  $('#tcPreset').addEventListener('click', () => {
    const p = PRESETS.find((x) => x.id === $('#presetSelect').value);
    if (p) S.tests = p.tests.map(([input, expected]) => ({ input, expected }));
    renderTests();
  });
  $('#tcRun').addEventListener('click', () => {
    if (!S.conv) return;
    const results = S.tests.map((t) => {
      const tok = A.tokenize(S.nfa.alphabet, t.input);
      if (tok.error) return { error: tok.error };
      const n = A.simulateNFA(S.nfa, tok.symbols).accepted;
      const d = A.simulateDFA(S.conv.dfa, tok.symbols).accepted;
      const m = S.min ? A.simulateDFA(S.min.dfa, tok.symbols).accepted : undefined;
      return { n, d, m, pass: n === t.expected && d === t.expected && (m === undefined || m === t.expected) };
    });
    renderTests(results);
    const pass = results.filter((r) => r.pass).length;
    const invalid = results.filter((r) => r.error);
    let html = msg(pass === results.length ? 'ok' : 'error', `<b>${pass} / ${results.length}</b> test case(s) passed.`);
    if (invalid.length) html += msgList('error', 'Invalid inputs:', invalid.map((r) => r.error));
    const disagree = results.filter((r) => !r.error && r.n !== r.d).length;
    if (!disagree && results.length) html += msg('info', 'NFA and DFA gave the same answer on every test. A FAIL here means the expected value (or the NFA itself) does not match the intended language.');
    $('#tcSummary').innerHTML = html;
  });

  $('#exRun').addEventListener('click', () => {
    if (!S.conv) return;
    const maxLen = Math.max(0, Math.min(20, Number($('#exLen').value) || 0));
    const r = A.exhaustiveCheck(S.nfa, S.conv.dfa, maxLen, 200000);
    let html = r.mismatches.length
      ? msgList('error', `${r.mismatches.length} mismatch(es) found:`, r.mismatches.map((m) => `"${m.string}": NFA ${m.nfa ? 'accepts' : 'rejects'}, DFA ${m.dfa ? 'accepts' : 'rejects'}`))
      : msg('ok', `✓ Checked <b>${r.checked.toLocaleString()}</b> strings of length 0…${maxLen}: NFA and DFA agree on every one.`);
    if (r.truncated) html += msg('warn', 'Stopped after 200,000 strings — lower the maximum length for a complete check.');
    $('#exOut').innerHTML = html;
  });

  $('#eqRun').addEventListener('click', () => {
    if (!S.conv) return;
    const r = A.exactEquivalence(S.nfa, S.conv.dfa);
    $('#eqOut').innerHTML = r.equivalent
      ? msg('ok', `✓ <b>L(NFA) = L(DFA)</b> — all ${r.pairs} reachable (NFA set, DFA state) pairs agree on acceptance.`)
      : msg('error', `✗ Languages differ. Shortest counterexample: "<b>${esc(r.counterexample)}</b>" (NFA ${r.nfa ? 'accepts' : 'rejects'}, DFA ${r.dfa ? 'accepts' : 'rejects'}).`);
  });

  // ================================================================== theme & init
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t);
  }
  try {
    applyTheme(localStorage.getItem('nfa2dfa-theme'));
  } catch (e) {
    /* storage unavailable */
  }
  $('#themeToggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem('nfa2dfa-theme', next);
    } catch (e) {
      /* ignore */
    }
  });

  populatePresets();
  const first = PRESETS[0];
  loadDefinition(first.definition, first.tests);
  updateConversionGate();
  renderTests();
})();
