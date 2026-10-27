import { isIngredient } from '../flavors.js';
import { canFillMix } from './shares.js';

const COOLING_ID = 'cooling';
const MIN_MIX_SIZE = 3;
const MAX_MIX_SIZE = 4;
const MIN_REAL_FLAVORS = 2;
const MAX_POOL_SIZE = 22;
const MIN_POOL_SIZE = 10;
const FALLBACK_MIN_AFFINITY = 0.25;
const PROPERTY_SEED_MIN_SCORE = 0.1;
const PROPERTY_SEED_LIMIT = 4;
const SEED_MIN_WEIGHT = 0.3;
const NEIGHBOR_MIN_AFFINITY = 0.5;
const NEIGHBOR_WEIGHT_FACTOR = 0.4;
const PROPERTY_CANDIDATES = 8;
const PROPERTY_WEIGHT_FACTOR = 0.35;
const CORE_WEIGHT_RATIO = 0.5;
const MAX_DISCOVERY_FLAVORS = 2;
const REQUIRED_COOLING_WEIGHT = 0.5;
const MAX_PER_CATEGORY = 2;
const MAX_STRONGEST_FLAVORS = 1;
const STRONGEST_INTENSITY = 5;
const HARD_CLASH_AFFINITY = -0.1;
const RARE_PAIR_MIN_AFFINITY = 0.3;
const CREAMY_IDS = new Set(['cream', 'vanilla', 'ice_cream', 'yogurt', 'coconut', 'condensed_milk', 'banana', 'cheesecake']);
const BITTER_IDS = new Set(['grapefruit', 'coffee', 'bergamot', 'lime', 'chocolate', 'mate', 'tobacco_leaf']);

export function propertyScore(flavor, propertyId) {
  switch (propertyId) {
    case 'sweet':
      return flavor.sweet / 5;
    case 'sour':
      return flavor.sour / 5;
    case 'fresh':
      return flavor.fresh / 5;
    case 'creamy':
      return CREAMY_IDS.has(flavor.id) ? 1 : ['dessert', 'nut'].includes(flavor.category) ? 0.5 : 0;
    case 'spicy':
      return flavor.category === 'spice' ? 1 : 0;
    case 'bitter':
      return BITTER_IDS.has(flavor.id) ? 1 : 0;
    default:
      return 0;
  }
}

export function buildPool(profile, catalog, graph) {
  const scores = new Map();
  const raise = (id, score) => scores.set(id, Math.max(scores.get(id) ?? 0, score));
  profile.weights.forEach((weight, id) => raise(id, weight));
  const seedEntries = neighborSeeds(profile);

  seedEntries.forEach(([id, weight]) => {
    graph.getPartners(id).forEach((partner) => {
      if (partner.affinity >= NEIGHBOR_MIN_AFFINITY) {
        raise(partner.id, weight * partner.affinity * NEIGHBOR_WEIGHT_FACTOR);
      }
    });
  });

  const seedIds = new Set(profile.weights.keys());
  const ingredients = catalog.flavors.filter(isIngredient);
  profile.properties.forEach((weight, propertyId) => {
    ingredients
      .filter((flavor) => flavor.id !== COOLING_ID)
      .map((flavor) => ({ id: flavor.id, score: propertyScore(flavor, propertyId) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, PROPERTY_CANDIDATES)
      .forEach(({ id, score }) => {
        raise(id, weight * score * PROPERTY_WEIGHT_FACTOR);
        seedIds.add(id);
      });
  });

  const isAllowed = (id) => {
    const flavor = catalog.flavorsById.get(id);
    return flavor && isIngredient(flavor) && !profile.excluded.has(id) && !profile.avoid.has(id);
  };
  const requiredIds = profile.required.filter(isAllowed);
  const isOptionalCandidate = (id) => id !== COOLING_ID && isAllowed(id) && !requiredIds.includes(id);
  const optionalCount = [...scores.keys()].filter(isOptionalCandidate).length;
  if (optionalCount < MIN_POOL_SIZE) {
    expandWithCategoryNeighbors(expansionSeeds(profile, scores), ingredients, graph, scores, raise);
  }
  const ranked = [...scores.entries()]
    .filter(([id]) => isOptionalCandidate(id))
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_POOL_SIZE - requiredIds.length);

  const flavorWeights = [...profile.weights.entries()].filter(([id]) => id !== COOLING_ID && isAllowed(id));
  const maxWeight = Math.max(0, ...flavorWeights.map(([, weight]) => weight));
  const coreIds = new Set(flavorWeights.filter(([, weight]) => weight >= maxWeight * CORE_WEIGHT_RATIO).map(([id]) => id));

  return {
    scores,
    coreIds,
    seedIds,
    requiredIds: requiredIds.filter((id) => id !== COOLING_ID),
    optionalIds: ranked.map(([id]) => id),
    coolingPolicy: resolveCoolingPolicy(profile, scores, isAllowed(COOLING_ID)),
  };
}

function neighborSeeds(profile) {
  const strongSeeds = [...profile.weights.entries()].filter(([, weight]) => weight >= SEED_MIN_WEIGHT);
  const flavorSeeds = strongSeeds.filter(([id]) => id !== COOLING_ID);
  return flavorSeeds.length > 0 ? flavorSeeds : strongSeeds;
}

function expansionSeeds(profile, scores) {
  const seeds = neighborSeeds(profile);
  if (seeds.length > 0) {
    return seeds;
  }
  return [...scores.entries()]
    .filter(([id, score]) => id !== COOLING_ID && score >= PROPERTY_SEED_MIN_SCORE)
    .sort((left, right) => right[1] - left[1])
    .slice(0, PROPERTY_SEED_LIMIT);
}

function expandWithCategoryNeighbors(seeds, ingredients, graph, scores, raise) {
  ingredients.forEach((flavor) => {
    if (flavor.id === COOLING_ID || scores.has(flavor.id)) {
      return;
    }
    const bestScore = Math.max(0, ...seeds.map(([seedId, weight]) => weight * graph.getPair(seedId, flavor.id).affinity));
    if (bestScore >= FALLBACK_MIN_AFFINITY) {
      raise(flavor.id, bestScore * NEIGHBOR_WEIGHT_FACTOR);
    }
  });
}

function resolveCoolingPolicy(profile, scores, isCoolingAllowed) {
  if (!isCoolingAllowed) {
    return 'none';
  }
  const coolingWeight = scores.get(COOLING_ID) ?? 0;
  if (profile.required.includes(COOLING_ID) || coolingWeight >= REQUIRED_COOLING_WEIGHT) {
    return 'required';
  }
  return coolingWeight > 0 ? 'optional' : 'none';
}

export function generateCandidates(pool, profile, catalog, graph) {
  const candidates = [];
  const coolingOptions = {
    required: [true],
    optional: [true, false],
    none: [false],
  }[pool.coolingPolicy];

  coolingOptions.forEach((withCooling) => {
    for (let size = MIN_MIX_SIZE; size <= MAX_MIX_SIZE; size += 1) {
      const realCount = withCooling ? size - 1 : size;
      const freeSlots = realCount - pool.requiredIds.length;
      if (realCount < MIN_REAL_FLAVORS || freeSlots < 0) {
        continue;
      }
      forEachCombination(pool.optionalIds, freeSlots, (chosen) => {
        const ids = [...pool.requiredIds, ...chosen, ...(withCooling ? [COOLING_ID] : [])];
        const candidate = evaluate(ids, pool, profile, catalog, graph);
        if (candidate) {
          candidates.push(candidate);
        }
      });
    }
  });
  return candidates;
}

function forEachCombination(items, size, callback) {
  const chosen = [];
  const walk = (start) => {
    if (chosen.length === size) {
      callback([...chosen]);
      return;
    }
    for (let index = start; index <= items.length - (size - chosen.length); index += 1) {
      chosen.push(items[index]);
      walk(index + 1);
      chosen.pop();
    }
  };
  walk(0);
}

function evaluate(ids, pool, profile, catalog, graph) {
  const flavors = ids.map((id) => catalog.flavorsById.get(id));
  const realFlavors = flavors.filter((flavor) => flavor.id !== COOLING_ID);
  if (!passesStructure(realFlavors) || !canFillMix(flavors, new Set(pool.requiredIds))) {
    return null;
  }
  if (pool.coreIds.size > 0 && !realFlavors.some((flavor) => pool.coreIds.has(flavor.id))) {
    return null;
  }
  const discoveryCount = realFlavors.filter((flavor) => !pool.seedIds.has(flavor.id)).length;
  if (discoveryCount > MAX_DISCOVERY_FLAVORS) {
    return null;
  }

  const pairs = [];
  for (let first = 0; first < ids.length; first += 1) {
    for (let second = first + 1; second < ids.length; second += 1) {
      const pair = graph.getPair(ids[first], ids[second]);
      const bothRequired = profile.required.includes(ids[first]) && profile.required.includes(ids[second]);
      if (pair.affinity < HARD_CLASH_AFFINITY && !bothRequired) {
        return null;
      }
      pairs.push({ ...pair, involvesCooling: ids[first] === COOLING_ID || ids[second] === COOLING_ID });
    }
  }

  const affinities = pairs.map((pair) => pair.affinity);
  const harmony = average(affinities);
  const minAffinity = Math.min(...affinities);
  const flavorPairs = pairs.filter((pair) => !pair.involvesCooling);
  const rarePairs = flavorPairs.filter((pair) => pair.familiarity === 'rare' && pair.affinity >= RARE_PAIR_MIN_AFFINITY);
  const classicPairs = flavorPairs.filter((pair) => pair.familiarity === 'classic');
  const novelty = 0.7 * (rarePairs.length / flavorPairs.length) + 0.3 * (discoveryCount / realFlavors.length);

  return {
    ids,
    flavors,
    pairs,
    harmony,
    minAffinity,
    novelty,
    rarePairCount: rarePairs.length,
    discoveryCount,
    familiarity: classicPairs.length / flavorPairs.length,
    baseScore: scoreBase(flavors, realFlavors, pool, profile, harmony, minAffinity),
  };
}

function passesStructure(realFlavors) {
  const strongestCount = realFlavors.filter((flavor) => flavor.intensity >= STRONGEST_INTENSITY).length;
  if (strongestCount > MAX_STRONGEST_FLAVORS) {
    return false;
  }
  const categoryCounts = new Map();
  for (const flavor of realFlavors) {
    const count = (categoryCounts.get(flavor.category) ?? 0) + 1;
    if (count > MAX_PER_CATEGORY) {
      return false;
    }
    categoryCounts.set(flavor.category, count);
  }
  return true;
}

function scoreBase(flavors, realFlavors, pool, profile, harmony, minAffinity) {
  const topScores = [...pool.scores.values()].sort((left, right) => right - left).slice(0, flavors.length);
  const maxRelevance = topScores.reduce((sum, score) => sum + score, 0) || 1;
  const relevance = flavors.reduce((sum, flavor) => sum + (pool.scores.get(flavor.id) ?? 0), 0) / maxRelevance;

  const averageSweet = average(realFlavors.map((flavor) => flavor.sweet));
  const averageSour = average(realFlavors.map((flavor) => flavor.sour));
  const averageFresh = average(flavors.map((flavor) => flavor.fresh));
  const cloyingPenalty = averageSweet >= 3.5 && averageSour + averageFresh < 2.5 ? 0.1 : 0;
  const sourPenalty = averageSour >= 3.5 && averageSweet < 1.5 ? 0.1 : 0;

  let propertyBonus = 0;
  profile.properties.forEach((weight, propertyId) => {
    propertyBonus += weight * average(realFlavors.map((flavor) => propertyScore(flavor, propertyId))) * 0.25;
  });

  const clashPenalty = Math.max(0, 0.15 - minAffinity);
  return 0.5 * Math.min(relevance, 1) + 0.4 * harmony + propertyBonus - cloyingPenalty - sourPenalty - clashPenalty;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
