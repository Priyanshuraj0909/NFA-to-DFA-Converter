/**
 * automata.js — Core Automata Theory algorithms for the NFA → DFA Converter.
 *
 * Pure functions with no DOM access, so the same file runs in the browser
 * (exposed as window.Automata) and in Node.js (module.exports) for testing.
 *
 * Contents
 *   - buildNFA            : parse + validate a user-defined (ε-)NFA
 *   - epsilonClosure/move : the two primitive operations of subset construction
 *   - subsetConstruction  : NFA → DFA with a full step-by-step trace
 *   - minimizeDFA         : Moore partition refinement (optional extension)
 *   - simulateNFA/DFA     : run a string and record every intermediate configuration
 *   - exhaustiveCheck / exactEquivalence : validation of L(NFA) = L(DFA)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Automata = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Canonical epsilon symbol used internally for ε-transitions. */
  const EPSILON = 'ε';
  /** Spellings the user may type for ε (e.g. keyboards without a Greek layout). */
  const EPSILON_ALIASES = new Set(['ε', 'eps', 'epsilon', 'λ', 'lambda', '^']);

  function isEpsilon(sym) {
    return EPSILON_ALIASES.has(String(sym).trim().toLowerCase());
  }

  /** Remove duplicates while keeping the first occurrence order. */
  function dedupe(list) {
    return [...new Set(list)];
  }

  /**
   * Turn "q0, q1 q2" / "{a,b}" / ['q0','q1'] into a clean array of names.
   * Commas, semicolons, whitespace and braces are all treated as separators.
   */
  function parseList(value) {
    if (Array.isArray(value)) return dedupe(value.map((s) => String(s).trim()).filter(Boolean));
    return dedupe(
      String(value == null ? '' : value)
        .split(/[\s,;{}]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }

  /** Printable form of a set of states: {q0, q1} or ∅. */
  function setLabel(set) {
    return set.length ? '{' + set.join(', ') + '}' : '∅';
  }

  /** DFA state names: A, B, …, Z, AA, AB, … */
  function dfaName(i) {
    let s = '';
    let n = i + 1;
    while (n > 0) {
      n--;
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26);
    }
    return s;
  }

  /** Sort NFA states by the order the user declared them (keeps sets canonical). */
  function sortStates(nfa, states) {
    return states.slice().sort((a, b) => nfa.index[a] - nfa.index[b]);
  }

  /**
   * Parse and validate a user-supplied NFA definition.
   *
   * def = {
   *   states:      "q0,q1" | ['q0','q1'],
   *   alphabet:    "a,b"   | ['a','b'],
   *   start:       'q0',
   *   finals:      "q1"    | ['q1'],
   *   transitions: { q0: { a: ['q0','q1'], ε: ['q1'] }, ... }   // object form
   *              | [ ['q0','a','q1'], ... ]                     // triple-list form
   * }
   *
   * Returns { nfa, errors, warnings }. nfa is null when errors is non-empty.
   */
  function buildNFA(def) {
    def = def || {};
    const errors = [];
    const warnings = [];

    const states = parseList(def.states);
    const alphabet = [];
    for (const a of parseList(def.alphabet)) {
      if (isEpsilon(a)) errors.push(`"${a}" is reserved for ε (empty string) and cannot be an input symbol.`);
      else alphabet.push(a);
    }
    if (!states.length) errors.push('Q is empty: define at least one state.');
    if (!alphabet.length) errors.push('Σ is empty: define at least one input symbol.');

    const stateSet = new Set(states);
    const symbolSet = new Set(alphabet);
    for (const s of states) {
      if (symbolSet.has(s)) warnings.push(`"${s}" is used both as a state name and as an input symbol.`);
    }

    const start = String(def.start == null ? '' : def.start).trim();
    if (!start) errors.push('No start state q₀ given.');
    else if (!stateSet.has(start)) errors.push(`Start state "${start}" is not in Q.`);

    const finals = parseList(def.finals);
    for (const f of finals) if (!stateSet.has(f)) errors.push(`Final state "${f}" is not in Q.`);
    if (!finals.length) warnings.push('F is empty: the NFA accepts no string, so L = ∅.');

    // δ : Q × (Σ ∪ {ε}) → P(Q), stored as delta[state][symbol] = [targets]
    const delta = {};
    for (const s of states) delta[s] = {};
    let hasEpsilon = false;
    const addTransition = (from, sym, to) => {
      from = String(from).trim();
      sym = String(sym).trim();
      to = String(to).trim();
      if (!from || !to) return;
      if (isEpsilon(sym)) {
        sym = EPSILON;
        hasEpsilon = true;
      }
      if (!stateSet.has(from)) return errors.push(`Transition from unknown state "${from}".`);
      if (sym !== EPSILON && !symbolSet.has(sym))
        return errors.push(`Transition δ(${from}, ${sym}) uses symbol "${sym}" which is not in Σ.`);
      if (!stateSet.has(to)) return errors.push(`Transition δ(${from}, ${sym}) goes to unknown state "${to}".`);
      const row = delta[from];
      if (!row[sym]) row[sym] = [];
      if (!row[sym].includes(to)) row[sym].push(to);
    };

    const t = def.transitions || {};
    if (Array.isArray(t)) {
      for (const triple of t) {
        if (!Array.isArray(triple) || triple.length < 3) {
          errors.push('Transition list entries must look like [from, symbol, to].');
          continue;
        }
        for (const to of parseList(triple[2])) addTransition(triple[0], triple[1], to);
      }
    } else {
      for (const from of Object.keys(t)) {
        for (const sym of Object.keys(t[from] || {})) {
          for (const to of parseList(t[from][sym])) addTransition(from, sym, to);
        }
      }
    }

    if (errors.length) return { nfa: null, errors: dedupe(errors), warnings };

    const index = {};
    states.forEach((s, i) => (index[s] = i));
    const nfa = { states, alphabet, start, finals, delta, index, hasEpsilon };
    for (const s of states) {
      for (const sym of Object.keys(delta[s])) delta[s][sym] = sortStates(nfa, delta[s][sym]);
    }

    // Unreachable states are legal but worth pointing out.
    const reach = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const s = queue.shift();
      for (const sym of Object.keys(delta[s])) {
        for (const t2 of delta[s][sym]) {
          if (!reach.has(t2)) {
            reach.add(t2);
            queue.push(t2);
          }
        }
      }
    }
    const unreachable = states.filter((s) => !reach.has(s));
    if (unreachable.length)
      warnings.push(`Unreachable from q₀: ${unreachable.join(', ')} (they can never appear in a DFA state).`);

    return { nfa, errors: [], warnings };
  }

  /**
   * ε-closure(T): all states reachable from T using only ε-moves (T included).
   * Uses an explicit stack (iterative DFS). Also returns the ε-edges used,
   * so the UI can explain *why* each state was added.
   */
  function epsilonClosure(nfa, set) {
    const result = new Set(set);
    const stack = [...set];
    const trace = [];
    while (stack.length) {
      const s = stack.pop();
      const targets = (nfa.delta[s] && nfa.delta[s][EPSILON]) || [];
      for (const t of targets) {
        if (!result.has(t)) {
          result.add(t);
          stack.push(t);
          trace.push([s, t]);
        }
      }
    }
    return { states: sortStates(nfa, [...result]), trace };
  }

  /** move(T, a): states reachable from some state in T on exactly one 'a' edge. */
  function move(nfa, set, sym) {
    const result = new Set();
    for (const s of set) {
      const targets = (nfa.delta[s] && nfa.delta[s][sym]) || [];
      for (const t of targets) result.add(t);
    }
    return sortStates(nfa, [...result]);
  }

  /**
   * Subset (powerset) construction.
   *
   *   Dstates ← { ε-closure({q0}) }   (unmarked)
   *   while there is an unmarked T in Dstates:
   *       mark T
   *       for each a ∈ Σ:
   *           U ← ε-closure(move(T, a))
   *           if U ∉ Dstates: add U as unmarked
   *           Dtran[T, a] ← U
   *   F' ← { T ∈ Dstates | T ∩ F ≠ ∅ }
   *
   * options.includeDeadState (default true): keep the ∅ subset as an explicit
   * trap state so the DFA is complete. When false, those transitions are omitted.
   * options.maxStates guards against runaway blow-ups (2^n).
   *
   * Returns { dfa, dStates, steps, edgeOrder }.
   *   steps[k].nStates / nEdges / nMarked say how much of the DFA exists after step k,
   *   so the UI can draw the DFA "as it was" at any step.
   */
  function subsetConstruction(nfa, options) {
    const opts = Object.assign({ includeDeadState: true, maxStates: 1024 }, options || {});
    const finalSet = new Set(nfa.finals);
    const dStates = [];
    const byKey = new Map();
    const delta = {};
    const edgeOrder = [];
    const steps = [];

    const addState = (set) => {
      const key = set.join('\u0001');
      if (byKey.has(key)) return { state: byKey.get(key), isNew: false };
      if (dStates.length >= opts.maxStates)
        throw new Error(`DFA exceeded ${opts.maxStates} states — stopping (subset blow-up).`);
      const st = {
        id: dfaName(dStates.length),
        set,
        label: setLabel(set),
        accepting: set.some((s) => finalSet.has(s)),
        dead: set.length === 0,
      };
      dStates.push(st);
      byKey.set(key, st);
      delta[st.id] = {};
      return { state: st, isNew: true };
    };
    const snapshot = (step, nMarked) =>
      steps.push(Object.assign(step, { nStates: dStates.length, nEdges: edgeOrder.length, nMarked }));

    const startClosure = epsilonClosure(nfa, [nfa.start]);
    const startState = addState(startClosure.states).state;
    snapshot(
      { type: 'start', of: [nfa.start], closure: startClosure.states, trace: startClosure.trace, to: startState.id },
      0
    );

    let i = 0;
    while (i < dStates.length) {
      const T = dStates[i++];
      snapshot({ type: 'mark', state: T.id, set: T.set }, i);
      for (const a of nfa.alphabet) {
        const M = move(nfa, T.set, a);
        const C = epsilonClosure(nfa, M);
        if (C.states.length === 0 && !opts.includeDeadState) {
          snapshot(
            { type: 'transition', from: T.id, fromSet: T.set, symbol: a, move: M, closure: [], trace: [], to: null, isNew: false },
            i
          );
          continue;
        }
        const { state: U, isNew } = addState(C.states);
        delta[T.id][a] = U.id;
        edgeOrder.push({ from: T.id, symbol: a, to: U.id });
        snapshot(
          { type: 'transition', from: T.id, fromSet: T.set, symbol: a, move: M, closure: C.states, trace: C.trace, to: U.id, isNew },
          i
        );
      }
    }

    const dfa = {
      states: dStates.map((s) => s.id),
      alphabet: nfa.alphabet.slice(),
      start: startState.id,
      finals: dStates.filter((s) => s.accepting).map((s) => s.id),
      delta,
      sets: Object.fromEntries(dStates.map((s) => [s.id, s.set])),
      dead: dStates.filter((s) => s.dead).map((s) => s.id),
    };
    snapshot({ type: 'done', finals: dfa.finals }, dStates.length);
    return { dfa, dStates, steps, edgeOrder };
  }

  /**
   * DFA minimisation by Moore's partition refinement.
   *   1. drop states unreachable from the start state
   *   2. complete the DFA with a trap state if any transition is missing
   *   3. P0 = { F, Q − F };  split groups until two states stay together only if,
   *      for every symbol, they move into the same group.
   * Returns { dfa, rounds, removed, trapAdded }.
   */
  function minimizeDFA(dfa) {
    const alphabet = dfa.alphabet;
    const reach = new Set([dfa.start]);
    const queue = [dfa.start];
    while (queue.length) {
      const s = queue.shift();
      for (const a of alphabet) {
        const t = dfa.delta[s] && dfa.delta[s][a];
        if (t !== undefined && !reach.has(t)) {
          reach.add(t);
          queue.push(t);
        }
      }
    }
    const states = dfa.states.filter((s) => reach.has(s));
    const removed = dfa.states.filter((s) => !reach.has(s));

    let trap = null;
    const delta = {};
    for (const s of states) {
      delta[s] = {};
      for (const a of alphabet) {
        let t = dfa.delta[s] && dfa.delta[s][a];
        if (t === undefined) {
          if (!trap) {
            trap = '∅';
            while (states.includes(trap)) trap += "'";
          }
          t = trap;
        }
        delta[s][a] = t;
      }
    }
    if (trap) {
      states.push(trap);
      delta[trap] = {};
      for (const a of alphabet) delta[trap][a] = trap;
    }

    const finalSet = new Set(dfa.finals);
    const groupsOf = (map) => {
      const groups = [];
      const pos = new Map();
      for (const s of states) {
        if (!pos.has(map[s])) {
          pos.set(map[s], groups.length);
          groups.push([]);
        }
        groups[pos.get(map[s])].push(s);
      }
      return groups;
    };

    // P0: accepting vs non-accepting (ids normalised to 0..k-1 by first appearance)
    let groupOf = {};
    {
      const ids = new Map();
      for (const s of states) {
        const k = finalSet.has(s) ? 'F' : 'N';
        if (!ids.has(k)) ids.set(k, ids.size);
        groupOf[s] = ids.get(k);
      }
    }
    const rounds = [{ round: 0, groups: groupsOf(groupOf), signatures: null }];

    for (;;) {
      const ids = new Map();
      const next = {};
      const signatures = {};
      for (const s of states) {
        const sig = groupOf[s] + '|' + alphabet.map((a) => groupOf[delta[s][a]]).join(',');
        signatures[s] = alphabet.map((a) => groupOf[delta[s][a]]);
        if (!ids.has(sig)) ids.set(sig, ids.size);
        next[s] = ids.get(sig);
      }
      const before = new Set(Object.values(groupOf)).size;
      groupOf = next;
      rounds.push({ round: rounds.length, groups: groupsOf(groupOf), signatures });
      if (ids.size === before) break;
    }

    // Build the quotient automaton. Group names join members with '+'.
    const groups = rounds[rounds.length - 1].groups;
    const nameOf = {};
    const minStates = groups.map((g) => {
      const name = g.join('+');
      for (const s of g) nameOf[s] = name;
      return name;
    });
    const minDelta = {};
    for (const g of groups) {
      const name = nameOf[g[0]];
      minDelta[name] = {};
      for (const a of alphabet) minDelta[name][a] = nameOf[delta[g[0]][a]];
    }
    // Put the start group first for nicer display.
    const startName = nameOf[dfa.start];
    const ordered = [startName, ...minStates.filter((n) => n !== startName)];
    const min = {
      states: ordered,
      alphabet: alphabet.slice(),
      start: startName,
      finals: ordered.filter((n) => groups.find((g) => nameOf[g[0]] === n).some((s) => finalSet.has(s))),
      delta: minDelta,
      sets: Object.fromEntries(groups.map((g) => [nameOf[g[0]], g])),
      dead: trap ? [nameOf[trap]] : [],
    };
    return { dfa: min, rounds, removed, trapAdded: !!trap };
  }

  /**
   * Split an input string into symbols of Σ.
   * Single-character alphabets: "abba" → a,b,b,a.
   * Multi-character alphabets (or input containing spaces/commas): split on separators.
   * "", "ε", "eps" all mean the empty string.
   */
  function tokenize(alphabet, input) {
    const trimmed = String(input == null ? '' : input).trim();
    if (trimmed === '' || isEpsilon(trimmed)) return { symbols: [], error: null };
    const multi = alphabet.some((a) => a.length > 1) || /[\s,]/.test(trimmed);
    const symbols = multi ? trimmed.split(/[\s,]+/).filter(Boolean) : [...trimmed];
    const bad = dedupe(symbols.filter((s) => !alphabet.includes(s)));
    if (bad.length) return { symbols, error: `Not in Σ: ${bad.join(', ')}` };
    return { symbols, error: null };
  }

  /** Printable form of a symbol sequence ("" → ε). */
  function formatString(symbols, alphabet) {
    if (!symbols.length) return EPSILON;
    return alphabet && alphabet.some((a) => a.length > 1) ? symbols.join(' ') : symbols.join('');
  }

  /** Run an (ε-)NFA on a symbol list, keeping the set of active states after every symbol. */
  function simulateNFA(nfa, symbols) {
    const finalSet = new Set(nfa.finals);
    const c0 = epsilonClosure(nfa, [nfa.start]).states;
    const trace = [{ index: 0, symbol: null, move: null, states: c0 }];
    let current = c0;
    symbols.forEach((a, k) => {
      const M = move(nfa, current, a);
      const C = epsilonClosure(nfa, M).states;
      trace.push({ index: k + 1, symbol: a, move: M, states: C });
      current = C;
    });
    return { accepted: current.some((s) => finalSet.has(s)), trace, final: current };
  }

  /** Run a DFA on a symbol list. A missing transition means the implicit dead state. */
  function simulateDFA(dfa, symbols) {
    const finalSet = new Set(dfa.finals);
    let current = dfa.start;
    const trace = [{ index: 0, symbol: null, state: current }];
    for (let k = 0; k < symbols.length; k++) {
      const next = current === null ? undefined : dfa.delta[current] && dfa.delta[current][symbols[k]];
      current = next === undefined ? null : next;
      trace.push({ index: k + 1, symbol: symbols[k], state: current });
    }
    return { accepted: current !== null && finalSet.has(current), trace, final: current };
  }

  /**
   * Brute-force validation: compare NFA and DFA on every string over Σ with
   * length ≤ maxLen (capped at `limit` strings). Walks the strings depth-first,
   * carrying the NFA state-set and DFA state incrementally.
   */
  function exhaustiveCheck(nfa, dfa, maxLen, limit) {
    limit = limit || 200000;
    const nfaFinal = new Set(nfa.finals);
    const dfaFinal = new Set(dfa.finals);
    const mismatches = [];
    let checked = 0;
    let truncated = false;
    const start = epsilonClosure(nfa, [nfa.start]).states;
    const walk = (prefix, set, d) => {
      if (checked >= limit) {
        truncated = true;
        return;
      }
      checked++;
      const nAcc = set.some((s) => nfaFinal.has(s));
      const dAcc = d !== null && dfaFinal.has(d);
      if (nAcc !== dAcc && mismatches.length < 25)
        mismatches.push({ string: formatString(prefix, nfa.alphabet), nfa: nAcc, dfa: dAcc });
      if (prefix.length >= maxLen) return;
      for (const a of nfa.alphabet) {
        const nextSet = epsilonClosure(nfa, move(nfa, set, a)).states;
        const t = d === null ? undefined : dfa.delta[d] && dfa.delta[d][a];
        walk(prefix.concat(a), nextSet, t === undefined ? null : t);
      }
    };
    walk([], start, dfa.start);
    return { checked, maxLen, mismatches, truncated };
  }

  /**
   * Exact language-equivalence test of an NFA and a DFA: breadth-first search
   * over the reachable pairs (NFA state-set, DFA state). The languages differ
   * iff some reachable pair disagrees on acceptance; BFS returns the shortest
   * such string as a counterexample.
   */
  function exactEquivalence(nfa, dfa) {
    const nfaFinal = new Set(nfa.finals);
    const dfaFinal = new Set(dfa.finals);
    const start = [epsilonClosure(nfa, [nfa.start]).states, dfa.start];
    const keyOf = (p) => p[0].join('\u0001') + '\u0002' + p[1];
    const seen = new Set([keyOf(start)]);
    const queue = [[start, []]];
    while (queue.length) {
      const [[set, d], path] = queue.shift();
      const nAcc = set.some((s) => nfaFinal.has(s));
      const dAcc = d !== null && dfaFinal.has(d);
      if (nAcc !== dAcc)
        return { equivalent: false, counterexample: formatString(path, nfa.alphabet), pairs: seen.size, nfa: nAcc, dfa: dAcc };
      for (const a of nfa.alphabet) {
        const nextSet = epsilonClosure(nfa, move(nfa, set, a)).states;
        const t = d === null ? undefined : dfa.delta[d] && dfa.delta[d][a];
        const pair = [nextSet, t === undefined ? null : t];
        const k = keyOf(pair);
        if (!seen.has(k)) {
          seen.add(k);
          queue.push([pair, path.concat(a)]);
        }
      }
    }
    return { equivalent: true, counterexample: null, pairs: seen.size };
  }

  /** Serialise an automaton to the same JSON shape buildNFA() accepts. */
  function toDefinition(automaton, isDFA) {
    const transitions = {};
    for (const s of automaton.states) {
      const row = automaton.delta[s] || {};
      const out = {};
      for (const sym of Object.keys(row)) out[sym] = isDFA ? [row[sym]] : row[sym].slice();
      if (Object.keys(out).length) transitions[s] = out;
    }
    const def = {
      type: isDFA ? 'DFA' : 'NFA',
      states: automaton.states.slice(),
      alphabet: automaton.alphabet.slice(),
      start: automaton.start,
      finals: automaton.finals.slice(),
      transitions,
    };
    if (isDFA && automaton.sets) def.subsets = automaton.sets;
    return def;
  }

  return {
    EPSILON,
    isEpsilon,
    parseList,
    setLabel,
    dfaName,
    buildNFA,
    epsilonClosure,
    move,
    subsetConstruction,
    minimizeDFA,
    tokenize,
    formatString,
    simulateNFA,
    simulateDFA,
    exhaustiveCheck,
    exactEquivalence,
    toDefinition,
  };
});
