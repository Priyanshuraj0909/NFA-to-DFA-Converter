/**
 * presets.js — Example NFAs with hand-verified test cases.
 * Shared by the browser UI (window.Presets) and the Node test-suite.
 * Each test is [input, expectedAccept].
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Presets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return [
    {
      id: 'ends-ab',
      name: 'Strings ending in "ab"',
      description:
        'Classic NFA over {a,b}: q0 guesses non-deterministically where the final "ab" starts. Converts to a 3-state DFA.',
      expectedDfaStates: 3,
      definition: {
        states: ['q0', 'q1', 'q2'],
        alphabet: ['a', 'b'],
        start: 'q0',
        finals: ['q2'],
        transitions: {
          q0: { a: ['q0', 'q1'], b: ['q0'] },
          q1: { b: ['q2'] },
        },
      },
      tests: [
        ['', false],
        ['a', false],
        ['b', false],
        ['ab', true],
        ['ba', false],
        ['aab', true],
        ['bab', true],
        ['abb', false],
        ['abab', true],
        ['bbbab', true],
      ],
    },
    {
      id: 'dragon-abb',
      name: 'ε-NFA for (a|b)*abb (Thompson)',
      description:
        'The 11-state ε-NFA produced by Thompson\'s construction for (a|b)*abb (Aho et al., "Compilers", Fig. 3.34). The textbook DFA has 5 states A–E.',
      expectedDfaStates: 5,
      definition: {
        states: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
        alphabet: ['a', 'b'],
        start: '0',
        finals: ['10'],
        transitions: {
          0: { ε: ['1', '7'] },
          1: { ε: ['2', '4'] },
          2: { a: ['3'] },
          3: { ε: ['6'] },
          4: { b: ['5'] },
          5: { ε: ['6'] },
          6: { ε: ['1', '7'] },
          7: { a: ['8'] },
          8: { b: ['9'] },
          9: { b: ['10'] },
        },
      },
      tests: [
        ['', false],
        ['abb', true],
        ['aabb', true],
        ['babb', true],
        ['ababb', true],
        ['abbabb', true],
        ['ab', false],
        ['abba', false],
        ['bbb', false],
        ['abab', false],
      ],
    },
    {
      id: 'third-last-1',
      name: 'Third symbol from the end is 1',
      description:
        'A 4-state NFA whose minimal DFA needs 2³ = 8 states — demonstrates the exponential blow-up of subset construction.',
      expectedDfaStates: 8,
      definition: {
        states: ['q0', 'q1', 'q2', 'q3'],
        alphabet: ['0', '1'],
        start: 'q0',
        finals: ['q3'],
        transitions: {
          q0: { 0: ['q0'], 1: ['q0', 'q1'] },
          q1: { 0: ['q2'], 1: ['q2'] },
          q2: { 0: ['q3'], 1: ['q3'] },
        },
      },
      tests: [
        ['', false],
        ['1', false],
        ['11', false],
        ['100', true],
        ['000', false],
        ['111', true],
        ['0100', true],
        ['0011', false],
        ['1011', false],
        ['01100', true],
      ],
    },
    {
      id: 'astar-bstar',
      name: 'a*b* with an ε-move (needs a dead state)',
      description:
        'p loops on a, q loops on b, and p –ε→ q. Reading "a" after a "b" leads to the empty set ∅, which becomes an explicit dead (trap) state.',
      expectedDfaStates: 3,
      definition: {
        states: ['p', 'q'],
        alphabet: ['a', 'b'],
        start: 'p',
        finals: ['q'],
        transitions: {
          p: { a: ['p'], ε: ['q'] },
          q: { b: ['q'] },
        },
      },
      tests: [
        ['', true],
        ['a', true],
        ['b', true],
        ['aaab', true],
        ['aabbb', true],
        ['ba', false],
        ['abab', false],
        ['bba', false],
      ],
    },
    {
      id: 'eps-cycle',
      name: 'Edge case: ε-cycle',
      description:
        'States 0 → 1 → 2 → 0 form an ε-cycle, so every ε-closure is {0,1,2}. The closure algorithm must terminate; the DFA has a single accepting state (L = Σ*).',
      expectedDfaStates: 1,
      definition: {
        states: ['0', '1', '2'],
        alphabet: ['a', 'b'],
        start: '0',
        finals: ['1'],
        transitions: {
          0: { ε: ['1'], a: ['1'] },
          1: { ε: ['2'] },
          2: { ε: ['0'], b: ['2'] },
        },
      },
      tests: [
        ['', true],
        ['a', true],
        ['ab', true],
        ['bbba', true],
      ],
    },
    {
      id: 'multi-symbol',
      name: 'Multi-character symbols (tokens)',
      description:
        'Σ = {if, id, else}. Input strings are written with spaces, e.g. "if id else id". Accepts "if id" optionally followed by "else id".',
      expectedDfaStates: 6,
      definition: {
        states: ['s0', 's1', 's2', 's3', 's4'],
        alphabet: ['if', 'id', 'else'],
        start: 's0',
        finals: ['s2', 's4'],
        transitions: {
          s0: { if: ['s1'] },
          s1: { id: ['s2'] },
          s2: { else: ['s3'] },
          s3: { id: ['s4'] },
        },
      },
      tests: [
        ['if id', true],
        ['if id else id', true],
        ['if', false],
        ['if id else', false],
        ['id', false],
        ['', false],
      ],
    },
  ];
});
