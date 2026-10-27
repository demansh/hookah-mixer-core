import { parseQuery } from './profile.js';
import { normalizeSelection, buildProfile, selectionContributions, selectionKey } from './selection.js';
import { getGraph } from './graph.js';
import { buildPool, generateCandidates } from './mixes.js';
import { allocateShares, findPrimaryIndex } from './shares.js';
import { randomFor, signedNoise } from './random.js';

export const MIXES_PER_PAGE = 3;

const TIERS = [
  {
    id: 'classic',
    jitter: 0.03,
    accepts: (candidate, pool) => candidate.novelty <= 0.5
      && (candidate.discoveryCount <= 1 || pool.seedIds.size < MIN_SEEDS_FOR_DISCOVERY_LIMIT),
    score: (candidate) => candidate.baseScore + 0.15 * candidate.familiarity - 0.25 * candidate.novelty
      + (candidate.rarePairCount > 0 ? 0.05 : 0) - 0.1 * candidate.discoveryCount,
  },
  {
    id: 'balanced',
    jitter: 0.035,
    accepts: (candidate) => candidate.novelty >= 0.25 && candidate.novelty <= 0.75,
    score: (candidate) => candidate.baseScore + 0.1 * candidate.novelty,
  },
  {
    id: 'bold',
    jitter: 0.05,
    accepts: (candidate) => candidate.novelty >= 0.5 && candidate.minAffinity >= 0.2,
    score: (candidate) => 0.8 * candidate.baseScore + 0.35 * candidate.novelty,
  },
];
const MAX_PAGE_SIMILARITY = 0.5;
const MIN_SEEDS_FOR_DISCOVERY_LIMIT = 2;
const RANKING_CACHE_SIZE = 5;
const COOLING_ID = 'cooling';
const RANDOM_PARTNER_MIN_AFFINITY = 0.4;
const RANDOM_SECOND_WEIGHT = 0.8;
const RANDOM_COOLING_PROBABILITY = 0.4;
const RANDOM_COOLING_WEIGHT = 0.4;
const rankingCache = new Map();

export async function recommend(request, catalog, page = 0) {
  const profile = parseQuery(request.query, catalog);
  return recommendForProfile(profile, catalog, page, { key: request.query.toLowerCase(), seed: request.seed });
}

export async function recommendSelection(request, catalog, page = 0) {
  const { seed, ...selection } = request;
  const normalized = normalizeSelection(selection, catalog);
  const profile = {
    ...buildProfile(selectionContributions(normalized), normalized.excluded, catalog),
    matched: [],
    selection: normalized,
  };
  return recommendForProfile(profile, catalog, page, { key: `selection:${selectionKey(normalized)}`, seed });
}

function recommendForProfile(profile, catalog, page, { key, seed }) {
  const random = seed === undefined ? Math.random : randomFor(seed, key, page);
  if (profile.isEmpty) {
    return randomResult(profile, catalog, random, seed);
  }
  const rankings = getRankings(key, profile, catalog, seed);
  const mixes = toMixes(selectPage(rankings, page), rankings, catalog);
  if (mixes.length > 0 || page > 0) {
    return { profile, mixes };
  }
  return randomResult(profile, catalog, random, seed);
}

function randomResult(parsedProfile, catalog, random, seed) {
  const randomProfile = buildRandomProfile(parsedProfile, catalog, random);
  const rankings = computeRankings(randomProfile, catalog, seed);
  return { profile: randomProfile, mixes: toMixes(selectPage(rankings, 0), rankings, catalog) };
}

function toMixes(selection, rankings, catalog) {
  return selection.map(({ tierId, candidate }) => toMix(tierId, candidate, rankings.pool, catalog));
}

function buildRandomProfile(parsedProfile, catalog, random) {
  const graph = getGraph(catalog);
  const isAllowed = (flavor) => flavor.kind === 'flavor' && flavor.id !== COOLING_ID && !parsedProfile.excluded.has(flavor.id);
  const ingredients = catalog.flavors.filter(isAllowed);
  const bases = ingredients.filter((flavor) => flavor.role === 'base');
  const first = pickRandom(bases.length > 0 ? bases : ingredients, random);
  const partners = graph.getPartners(first.id)
    .filter((partner) => partner.affinity >= RANDOM_PARTNER_MIN_AFFINITY)
    .map((partner) => catalog.flavorsById.get(partner.id))
    .filter((flavor) => isAllowed(flavor) && flavor.category !== first.category);
  const second = pickRandom(partners.length > 0 ? partners : ingredients.filter((flavor) => flavor.id !== first.id), random);
  const weights = new Map([[first.id, 1], [second.id, RANDOM_SECOND_WEIGHT]]);
  if (!parsedProfile.excluded.has(COOLING_ID) && random() < RANDOM_COOLING_PROBABILITY) {
    weights.set(COOLING_ID, RANDOM_COOLING_WEIGHT);
  }
  return { ...parsedProfile, weights, isEmpty: false, isRandom: true };
}

function pickRandom(items, random) {
  return items[Math.floor(random() * items.length)];
}

function getRankings(key, profile, catalog, seed) {
  const cacheKey = JSON.stringify([key, [...profile.excluded].sort(), seed ?? null]);
  if (rankingCache.has(cacheKey)) {
    return rankingCache.get(cacheKey);
  }
  const rankings = computeRankings(profile, catalog, seed);
  rankingCache.set(cacheKey, rankings);
  if (rankingCache.size > RANKING_CACHE_SIZE) {
    rankingCache.delete(rankingCache.keys().next().value);
  }
  return rankings;
}

function computeRankings(profile, catalog, seed) {
  const graph = getGraph(catalog);
  const pool = buildPool(profile, catalog, graph);
  const candidates = generateCandidates(pool, profile, catalog, graph);
  const byTier = new Map(TIERS.map((tier) => {
    const scores = new Map(candidates.map((candidate) => {
      const jitter = seed === undefined ? 0 : tier.jitter * signedNoise(seed, tier.id, candidateKey(candidate));
      return [candidate, tier.score(candidate) + jitter];
    }));
    const byScore = (left, right) => scores.get(right) - scores.get(left);
    const accepted = candidates.filter((candidate) => tier.accepts(candidate, pool)).sort(byScore);
    const acceptedSet = new Set(accepted);
    const rest = candidates.filter((candidate) => !acceptedSet.has(candidate)).sort(byScore);
    return [tier.id, [...accepted, ...rest]];
  }));
  candidates.forEach((candidate) => {
    candidate.primaryId = candidate.ids[findPrimaryIndex(candidate.flavors, relevanceFor(candidate, pool))];
  });
  return { pool, byTier, graph };
}

function selectPage(rankings, page) {
  const usedKeys = new Set();
  let selection = [];
  for (let pageIndex = 0; pageIndex <= page; pageIndex += 1) {
    selection = [];
    TIERS.forEach((tier) => {
      const ranked = rankings.byTier.get(tier.id);
      const pick = findPick(ranked, usedKeys, selection, { distinctPrimary: true, distinctFlavors: true })
        ?? findPick(ranked, usedKeys, selection, { distinctPrimary: false, distinctFlavors: true })
        ?? findPick(ranked, usedKeys, selection, { distinctPrimary: false, distinctFlavors: false });
      if (pick) {
        usedKeys.add(candidateKey(pick));
        selection.push({ tierId: tier.id, candidate: pick });
      }
    });
  }
  return selection;
}

function findPick(ranked, usedKeys, selection, { distinctPrimary, distinctFlavors }) {
  return ranked.find((candidate) => {
    if (usedKeys.has(candidateKey(candidate))) {
      return false;
    }
    return selection.every(({ candidate: picked }) => {
      if (distinctPrimary && picked.primaryId === candidate.primaryId) {
        return false;
      }
      return !distinctFlavors || similarity(candidate, picked) <= MAX_PAGE_SIMILARITY;
    });
  });
}

function relevanceFor(candidate, pool) {
  const maxScore = Math.max(...pool.scores.values(), 1);
  return new Map(candidate.ids.map((id) => [id, (pool.scores.get(id) ?? 0) / maxScore]));
}

function candidateKey(candidate) {
  return [...candidate.ids].sort().join('+');
}

function similarity(left, right) {
  const leftIds = new Set(left.ids.filter((id) => id !== COOLING_ID));
  const rightIds = right.ids.filter((id) => id !== COOLING_ID);
  const shared = rightIds.filter((id) => leftIds.has(id)).length;
  return shared / (leftIds.size + rightIds.length - shared);
}

function toMix(tierId, candidate, pool, catalog) {
  const shares = allocateShares(candidate.flavors, relevanceFor(candidate, pool), new Set(pool.requiredIds));
  const components = candidate.ids
    .map((flavorId, index) => ({ flavorId, share: shares[index] }))
    .sort((left, right) => right.share - left.share);
  return { tier: tierId, components, note: pickNote(tierId, candidate) };
}

export function noteForMix(mix, catalog) {
  const graph = getGraph(catalog);
  const ids = mix.components.map((component) => component.flavorId);
  const pairs = [];
  for (let first = 0; first < ids.length; first += 1) {
    for (let second = first + 1; second < ids.length; second += 1) {
      pairs.push(graph.getPair(ids[first], ids[second]));
    }
  }
  return pickNote(mix.tier, { pairs });
}

function pickNote(tierId, candidate) {
  const notedPairs = candidate.pairs.filter((pair) => pair.note);
  if (notedPairs.length === 0) {
    return null;
  }
  const preferRare = tierId !== 'classic';
  const ranked = [...notedPairs].sort((left, right) => {
    if (preferRare) {
      const rarity = Number(right.familiarity === 'rare') - Number(left.familiarity === 'rare');
      if (rarity !== 0) {
        return rarity;
      }
    }
    return right.affinity - left.affinity;
  });
  return ranked[0].note;
}
