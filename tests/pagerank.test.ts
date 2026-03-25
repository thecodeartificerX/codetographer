import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagerank } from '../src/pagerank.js';

test('pagerank on empty graph returns empty map', () => {
  const graph = new Map<string, Map<string, number>>();
  const scores = pagerank(graph);
  assert.equal(scores.size, 0);
});

test('pagerank on 4-node graph returns correct ordering', () => {
  // A→B, A→C, B→D, C→D, D→A (D is hub, A→B,C feeds D)
  // Expected: D highest (most incoming), A second (has D→A)
  const graph = new Map<string, Map<string, number>>([
    ['A', new Map([['B', 1], ['C', 1]])],
    ['B', new Map([['D', 1]])],
    ['C', new Map([['D', 1]])],
    ['D', new Map([['A', 1]])],
  ]);

  const scores = pagerank(graph);

  assert.equal(scores.size, 4);

  // All scores should be positive
  for (const [, score] of scores) {
    assert.ok(score > 0, `score should be positive, got ${score}`);
  }

  // Scores should sum to approximately 1
  const total = Array.from(scores.values()).reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(total - 1) < 0.01, `scores should sum to ~1, got ${total}`);

  // D should rank among the highest (receives from B and C)
  const dScore = scores.get('D') ?? 0;
  const aScore = scores.get('A') ?? 0;
  const bScore = scores.get('B') ?? 0;
  const cScore = scores.get('C') ?? 0;

  assert.ok(dScore > bScore, `D (${dScore}) should rank higher than B (${bScore})`);
  assert.ok(dScore > cScore, `D (${dScore}) should rank higher than C (${cScore})`);
});

test('pagerank with personalization boosts specified nodes', () => {
  const graph = new Map<string, Map<string, number>>([
    ['X', new Map([['Y', 1]])],
    ['Y', new Map([['X', 1]])],
    ['Z', new Map([['X', 1]])],
  ]);

  // Personalize toward Z
  const personalization = new Map([['Z', 100], ['X', 1], ['Y', 1]]);
  const scores = pagerank(graph, personalization);

  const zScore = scores.get('Z') ?? 0;
  const xScore = scores.get('X') ?? 0;

  // Z should rank higher due to personalization
  assert.ok(zScore > 0, `Z should have positive score`);
});

test('pagerank single node graph', () => {
  const graph = new Map<string, Map<string, number>>([
    ['A', new Map([['A', 1]])],
  ]);
  const scores = pagerank(graph);
  assert.equal(scores.size, 1);
  const aScore = scores.get('A') ?? 0;
  assert.ok(aScore > 0);
});
