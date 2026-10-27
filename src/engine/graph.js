const IMPLICIT_AFFINITY_FACTOR = 0.7;
const IMPLICIT_FAMILIARITY = 'rare';
const graphCache = new WeakMap();

export function getGraph(catalog) {
  if (!graphCache.has(catalog)) {
    graphCache.set(catalog, buildGraph(catalog));
  }
  return graphCache.get(catalog);
}

function pairKey(first, second) {
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function buildGraph(catalog) {
  const explicitPairs = new Map();
  const partnersById = new Map();
  const categoryAffinity = new Map();

  catalog.graph.categoryAffinity.forEach(({ a, b, affinity }) => {
    categoryAffinity.set(pairKey(a, b), affinity);
  });

  catalog.graph.pairs.forEach((pair) => {
    explicitPairs.set(pairKey(pair.a, pair.b), pair);
    [[pair.a, pair.b], [pair.b, pair.a]].forEach(([flavorId, partnerId]) => {
      if (!partnersById.has(flavorId)) {
        partnersById.set(flavorId, []);
      }
      partnersById.get(flavorId).push({ id: partnerId, affinity: pair.affinity });
    });
  });
  partnersById.forEach((partners) => partners.sort((left, right) => right.affinity - left.affinity));

  const getPair = (firstId, secondId) => {
    const explicit = explicitPairs.get(pairKey(firstId, secondId));
    if (explicit) {
      return explicit;
    }
    const firstCategory = catalog.flavorsById.get(firstId).category;
    const secondCategory = catalog.flavorsById.get(secondId).category;
    const affinity = (categoryAffinity.get(pairKey(firstCategory, secondCategory)) ?? 0) * IMPLICIT_AFFINITY_FACTOR;
    return { a: firstId, b: secondId, affinity, familiarity: IMPLICIT_FAMILIARITY, note: null, implicit: true };
  };

  const getPartners = (flavorId) => partnersById.get(flavorId) ?? [];

  return { getPair, getPartners };
}
