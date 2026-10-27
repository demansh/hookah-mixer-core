const ROLE_WEIGHTS = { primary: 50, base: 35, accent: 25, support: 15, cooling: 10 };
const REQUIRED_CAP_BONUS = 10;
const MAX_FLAVOR_SHARE = 60;
const INTENSITY_CAPS = { 1: 60, 2: 55, 3: 45, 4: 30, 5: 15 };
const COOLING_LIMITS = { min: 5, max: 15 };
const FLAVOR_MIN_SHARE = 10;
const SHARE_STEP = 5;
const TOTAL_SHARE = 100;
const RELEVANCE_INFLUENCE = 0.3;
const MAX_BALANCING_ROUNDS = 10;
const PRIMARY_MAX_INTENSITY = 3;
const BASE_ROLE_BONUS = 0.1;

export function shareLimits(flavor) {
  if (flavor.role === 'cooling') {
    return COOLING_LIMITS;
  }
  return { min: FLAVOR_MIN_SHARE, max: INTENSITY_CAPS[flavor.intensity] };
}

export function mixLimits(flavors, requiredIds = new Set()) {
  return flavors.map((flavor) => {
    const limit = shareLimits(flavor);
    if (!requiredIds.has(flavor.id)) {
      return limit;
    }
    return { ...limit, max: Math.min(MAX_FLAVOR_SHARE, limit.max + REQUIRED_CAP_BONUS) };
  });
}

export function canFillMix(flavors, requiredIds = new Set()) {
  const limits = mixLimits(flavors, requiredIds);
  const maxTotal = limits.reduce((sum, limit) => sum + limit.max, 0);
  const minTotal = limits.reduce((sum, limit) => sum + limit.min, 0);
  return maxTotal >= TOTAL_SHARE && minTotal <= TOTAL_SHARE;
}

export function allocateShares(flavors, relevanceById, requiredIds = new Set()) {
  const limits = mixLimits(flavors, requiredIds);
  const primaryIndex = findPrimaryIndex(flavors, relevanceById);
  const rawWeights = flavors.map((flavor, index) => {
    const role = index === primaryIndex ? 'primary' : flavor.role;
    const relevance = relevanceById.get(flavor.id) ?? 0;
    return ROLE_WEIGHTS[role] * (1 - RELEVANCE_INFLUENCE + RELEVANCE_INFLUENCE * relevance);
  });
  const shares = balanceWithinLimits(rawWeights, limits);
  return roundToStep(shares, limits);
}

export function findPrimaryIndex(flavors, relevanceById) {
  const canLead = (flavor) => flavor.role === 'base' || flavor.intensity <= PRIMARY_MAX_INTENSITY;
  const rank = (flavor) => (relevanceById.get(flavor.id) ?? 0) + (flavor.role === 'base' ? BASE_ROLE_BONUS : 0);
  let bestIndex = -1;
  flavors.forEach((flavor, index) => {
    if (flavor.role === 'cooling' || !canLead(flavor)) {
      return;
    }
    if (bestIndex === -1 || rank(flavor) > rank(flavors[bestIndex])) {
      bestIndex = index;
    }
  });
  if (bestIndex !== -1) {
    return bestIndex;
  }
  flavors.forEach((flavor, index) => {
    if (flavor.role !== 'cooling' && (bestIndex === -1 || flavor.intensity < flavors[bestIndex].intensity)) {
      bestIndex = index;
    }
  });
  return bestIndex;
}

function balanceWithinLimits(rawWeights, limits) {
  const shares = new Array(rawWeights.length).fill(0);
  const fixed = new Array(rawWeights.length).fill(false);
  for (let round = 0; round < MAX_BALANCING_ROUNDS; round += 1) {
    const fixedTotal = shares.reduce((sum, share, index) => sum + (fixed[index] ? share : 0), 0);
    const freeWeight = rawWeights.reduce((sum, weight, index) => sum + (fixed[index] ? 0 : weight), 0);
    if (freeWeight === 0) {
      break;
    }
    let changed = false;
    rawWeights.forEach((weight, index) => {
      if (!fixed[index]) {
        shares[index] = (weight / freeWeight) * (TOTAL_SHARE - fixedTotal);
      }
    });
    shares.forEach((share, index) => {
      if (fixed[index]) {
        return;
      }
      const { min, max } = limits[index];
      if (share > max || share < min) {
        shares[index] = Math.min(max, Math.max(min, share));
        fixed[index] = true;
        changed = true;
      }
    });
    if (!changed) {
      break;
    }
  }
  return shares;
}

function roundToStep(shares, limits) {
  const rounded = shares.map((share, index) => {
    const { min, max } = limits[index];
    return Math.min(max, Math.max(min, Math.round(share / SHARE_STEP) * SHARE_STEP));
  });
  let difference = TOTAL_SHARE - rounded.reduce((sum, share) => sum + share, 0);
  const order = rounded.map((_, index) => index).sort((left, right) => rounded[right] - rounded[left]);
  let guard = 0;
  while (difference !== 0 && guard < 100) {
    const direction = Math.sign(difference);
    const adjustable = order.find((index) => {
      const next = rounded[index] + direction * SHARE_STEP;
      return next >= limits[index].min && next <= limits[index].max;
    });
    if (adjustable === undefined) {
      break;
    }
    rounded[adjustable] += direction * SHARE_STEP;
    difference -= direction * SHARE_STEP;
    guard += 1;
  }
  return rounded;
}
