/**
 * Automated test-suite for the NFA → DFA Converter core (js/automata.js).
 * Run with:  node tests/run-tests.js      (no dependencies needed)
 *
 * Every test prints Expected vs Actual so the output can be pasted
 * straight into the report's test-case table.
 */
'use strict';
const path = require('path');
const A = require(path.join(__dirname, '..', 'js', 'automata.js'));
const PRESETS = require(path.join(__dirname, '..', 'js', 'presets.js'));

let passed = 0;
let failed = 0;
const fmt = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

function check(name, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        expected: ${fmt(expected)}\n        actual:   ${fmt(actual)}`);
}

function section(title) {
  console.log('\n=== ' + title + ' ===');
}

/** Independent reference: does the NFA accept? (recursive path search, no subset construction) */
function referenceAccepts(nfa, symbols) {
  const memo = new Set();
  const visit = (state, pos, epsSeen) => {
    const key = state + '@' + pos;
    if (epsSeen.has(key)) return false; // ε-cycle guard
    if (pos === symbols.length && nfa.finals.includes(state)) return true;
    const row = nfa.delta[state] || {};
    const seen = new Set(epsSeen).add(key);
    for (const t of row[A.EPSILON] || []) if (visit(t, pos, seen)) return true;
    if (pos < symbols.length) {
      const k2 = state + '#' + pos;
      if (memo.has(k2)) return false;
      memo.add(k2);
      for (const t of row[symbols[pos]] || []) if (visit(t, pos + 1, new Set())) return true;
    }
    return false;
  };
  return visit(nfa.start, 0, new Set());
}

// ---------------------------------------------------------------- 1. Presets
section('1. Preset automata — DFA size and string acceptance');
for (const p of PRESETS) {
  const { nfa, errors } = A.buildNFA(p.definition);
  check(`[${p.id}] definition valid`, [], errors);
  const { dfa } = A.subsetConstruction(nfa);
  check(`[${p.id}] DFA state count`, p.expectedDfaStates, dfa.states.length);
  for (const [input, expected] of p.tests) {
    const { symbols } = A.tokenize(nfa.alphabet, input);
    const n = A.simulateNFA(nfa, symbols).accepted;
    const d = A.simulateDFA(dfa, symbols).accepted;
    check(`[${p.id}] "${input || 'ε'}"  (NFA, DFA)`, [expected, expected], [n, d]);
  }
  check(`[${p.id}] exact L(NFA) = L(DFA)`, true, A.exactEquivalence(nfa, dfa).equivalent);
  const ex = A.exhaustiveCheck(nfa, dfa, 8);
  check(`[${p.id}] exhaustive check, all ${ex.checked} strings ≤ length 8`, 0, ex.mismatches.length);
}

// ------------------------------------------------- 2. Manually validated example
section('2. Manually validated example: Thompson ε-NFA for (a|b)*abb');
{
  const { nfa } = A.buildNFA(PRESETS.find((p) => p.id === 'dragon-abb').definition);
  const { dfa } = A.subsetConstruction(nfa);
  const sets = Object.fromEntries(dfa.states.map((s) => [s, A.setLabel(dfa.sets[s])]));
  check('ε-closure({0})', ['0', '1', '2', '4', '7'], A.epsilonClosure(nfa, ['0']).states);
  check('move(A, a)', ['3', '8'], A.move(nfa, dfa.sets.A, 'a'));
  check('subsets A–E (textbook values)', {
    A: '{0, 1, 2, 4, 7}',
    B: '{1, 2, 3, 4, 6, 7, 8}',
    C: '{1, 2, 4, 5, 6, 7}',
    D: '{1, 2, 4, 5, 6, 7, 9}',
    E: '{1, 2, 4, 5, 6, 7, 10}',
  }, sets);
  check('Dtran (textbook table)', {
    A: { a: 'B', b: 'C' },
    B: { a: 'B', b: 'D' },
    C: { a: 'B', b: 'C' },
    D: { a: 'B', b: 'E' },
    E: { a: 'B', b: 'C' },
  }, dfa.delta);
  check('accepting DFA states', ['E'], dfa.finals);
  const min = A.minimizeDFA(dfa);
  check('minimised DFA merges A and C (4 states)', ['A+C', 'B', 'D', 'E'], min.dfa.states);
}

// ---------------------------------------------------------------- 3. Edge cases
section('3. Edge cases');
{
  const r = A.buildNFA({ states: '', alphabet: '', start: '', finals: '' });
  check('empty definition rejected', true, r.errors.length >= 3 && r.nfa === null);

  const bad = A.buildNFA({ states: 'q0', alphabet: 'a', start: 'q9', finals: 'q0', transitions: { q0: { b: ['q0'], a: ['qx'] } } });
  check('unknown start / symbol / target reported', 3, bad.errors.length);

  const eps = A.buildNFA({ states: 'q0', alphabet: 'a, ε', start: 'q0', finals: '' });
  check('ε not allowed inside Σ', true, eps.errors.some((e) => e.includes('reserved')));

  const noFinal = A.buildNFA({ states: 'q0,q1', alphabet: 'a', start: 'q0', finals: '', transitions: { q0: { a: 'q1' } } });
  const nfDfa = A.subsetConstruction(noFinal.nfa).dfa;
  check('F = ∅ → DFA has no accepting state', [], nfDfa.finals);
  check('F = ∅ → warning shown', true, noFinal.warnings.some((w) => w.includes('F is empty')));

  const unreach = A.buildNFA({ states: 'q0,q1,q2', alphabet: 'a', start: 'q0', finals: 'q2', transitions: { q0: { a: 'q0' }, q2: { a: 'q1' } } });
  check('unreachable states warned', true, unreach.warnings.some((w) => w.includes('q1, q2')));
  check('unreachable final → DFA accepts nothing', [], A.subsetConstruction(unreach.nfa).dfa.finals);

  const startFinal = A.buildNFA({ states: 'q0', alphabet: 'a', start: 'q0', finals: 'q0' });
  const sfDfa = A.subsetConstruction(startFinal.nfa).dfa;
  check('start state final → ε accepted', true, A.simulateDFA(sfDfa, []).accepted);
  check('no transitions → dead state created', 2, sfDfa.states.length);
  check('no transitions, dead state disabled → 1 state', 1, A.subsetConstruction(startFinal.nfa, { includeDeadState: false }).dfa.states.length);
  check('missing transition with dead state disabled rejects "a"', false, A.simulateDFA(A.subsetConstruction(startFinal.nfa, { includeDeadState: false }).dfa, ['a']).accepted);

  const aliases = A.buildNFA({ states: 'p,q', alphabet: 'a', start: 'p', finals: 'q', transitions: [['p', 'eps', 'q'], ['q', 'λ', 'p']] });
  check('ε aliases (eps, λ) accepted', ['p', 'q'], A.epsilonClosure(aliases.nfa, ['p']).states);

  check('tokenize "abba"', ['a', 'b', 'b', 'a'], A.tokenize(['a', 'b'], 'abba').symbols);
  check('tokenize rejects symbol outside Σ', 'Not in Σ: c', A.tokenize(['a', 'b'], 'abc').error);
  check('tokenize "ε" = empty string', [], A.tokenize(['a'], 'ε').symbols);
  check('tokenize multi-char symbols', ['if', 'id'], A.tokenize(['if', 'id'], 'if id').symbols);

  const wrongDfa = { states: ['X'], alphabet: ['a', 'b'], start: 'X', finals: ['X'], delta: { X: { a: 'X', b: 'X' } } };
  const endsAb = A.buildNFA(PRESETS[0].definition).nfa;
  const ce = A.exactEquivalence(endsAb, wrongDfa);
  check('validator detects a wrong DFA (shortest counterexample ε)', [false, 'ε'], [ce.equivalent, ce.counterexample]);

  let threw = false;
  try {
    A.subsetConstruction(A.buildNFA(PRESETS[2].definition).nfa, { maxStates: 4 });
  } catch (e) {
    threw = true;
  }
  check('state-limit guard stops blow-up', true, threw);
}

// ---------------------------------------------------------------- 4. Fuzzing
section('4. Randomised NFAs vs independent reference simulator');
{
  let seed = 20261123;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let cases = 0;
  let agree = 0;
  let equivalent = 0;
  const N = 300;
  for (let t = 0; t < N; t++) {
    const n = 1 + Math.floor(rand() * 5);
    const states = Array.from({ length: n }, (_, i) => 'q' + i);
    const alphabet = rand() < 0.5 ? ['a', 'b'] : ['0', '1', '2'];
    const triples = [];
    for (const s of states)
      for (const sym of [...alphabet, 'ε'])
        for (const to of states) if (rand() < (sym === 'ε' ? 0.15 : 0.3)) triples.push([s, sym, to]);
    const finals = states.filter(() => rand() < 0.35);
    const { nfa } = A.buildNFA({ states, alphabet, start: 'q0', finals, transitions: triples });
    const { dfa } = A.subsetConstruction(nfa, { includeDeadState: rand() < 0.5 });
    if (A.exactEquivalence(nfa, dfa).equivalent) equivalent++;
    for (let k = 0; k < 15; k++) {
      const len = Math.floor(rand() * 7);
      const w = Array.from({ length: len }, () => alphabet[Math.floor(rand() * alphabet.length)]);
      cases++;
      if (referenceAccepts(nfa, w) === A.simulateDFA(dfa, w).accepted) agree++;
    }
  }
  check(`${N} random NFAs: exact equivalence holds`, N, equivalent);
  check(`${cases} random strings: DFA agrees with reference NFA search`, cases, agree);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
