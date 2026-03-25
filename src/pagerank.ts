/**
 * Iterative PageRank implementation.
 * @param graph - adjacency list: Map<node, Map<neighbor, weight>>
 * @param personalization - optional Map<node, weight> for personalized PageRank
 * @param dampingFactor - damping factor (default 0.85)
 * @param iterations - number of iterations (default 20)
 * @returns Map<node, score>
 */
export function pagerank(
  graph: Map<string, Map<string, number>>,
  personalization?: Map<string, number>,
  dampingFactor = 0.85,
  iterations = 20
): Map<string, number> {
  const nodes = new Set<string>();
  for (const [node, neighbors] of graph) {
    nodes.add(node);
    for (const neighbor of neighbors.keys()) nodes.add(neighbor);
  }

  const N = nodes.size;
  if (N === 0) return new Map();

  const nodeList = Array.from(nodes);

  // Build personalization vector (uniform if not provided)
  let personalVector: Map<string, number>;
  if (personalization && personalization.size > 0) {
    let total = 0;
    for (const v of personalization.values()) total += v;
    personalVector = new Map();
    for (const node of nodeList) {
      const v = personalization.get(node) ?? 0;
      personalVector.set(node, v / total);
    }
  } else {
    personalVector = new Map();
    const uniform = 1 / N;
    for (const node of nodeList) personalVector.set(node, uniform);
  }

  // Compute out-weights per node
  const outWeight = new Map<string, number>();
  for (const [node, neighbors] of graph) {
    let total = 0;
    for (const w of neighbors.values()) total += w;
    outWeight.set(node, total);
  }

  // Initialize ranks
  let ranks = new Map<string, number>();
  for (const node of nodeList) ranks.set(node, 1 / N);

  for (let iter = 0; iter < iterations; iter++) {
    const newRanks = new Map<string, number>();

    // Initialize with (1 - d) * personalization
    for (const node of nodeList) {
      newRanks.set(node, (1 - dampingFactor) * (personalVector.get(node) ?? 0));
    }

    // Add d * sum of incoming contributions
    for (const [src, neighbors] of graph) {
      const srcRank = ranks.get(src) ?? 0;
      const srcOut = outWeight.get(src) ?? 0;
      if (srcOut === 0) continue;

      for (const [dst, weight] of neighbors) {
        const contribution = dampingFactor * srcRank * (weight / srcOut);
        newRanks.set(dst, (newRanks.get(dst) ?? 0) + contribution);
      }
    }

    ranks = newRanks;
  }

  return ranks;
}
