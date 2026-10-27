import { isIngredient, flavorLabel } from './flavors.js';

const TIERS = new Set(['classic', 'balanced', 'bold']);
const DEFAULT_TIER = 'balanced';
const MIN_COMPONENTS = 2;
const MAX_COMPONENTS = 4;
const SHARE_STEP = 5;
const TOTAL_SHARE = 100;
const MAX_QUERY_LENGTH = 200;

export function mixToParams(mix, query) {
  const params = new URLSearchParams();
  params.set('mix', mix.components.map(({ flavorId, share }) => `${flavorId}.${share}`).join(','));
  params.set('tier', mix.tier);
  if (query) {
    params.set('q', query.slice(0, MAX_QUERY_LENGTH));
  }
  return params;
}

export function parseMixParams(params, catalog) {
  const encoded = params.get('mix');
  if (!encoded) {
    return null;
  }
  const parts = encoded.split(',');
  if (parts.length < MIN_COMPONENTS || parts.length > MAX_COMPONENTS) {
    return null;
  }
  const components = [];
  for (const part of parts) {
    const match = /^([a-z][a-z0-9_]*)\.(\d{1,3})$/.exec(part);
    if (!match) {
      return null;
    }
    const [, flavorId, rawShare] = match;
    const share = Number(rawShare);
    const flavor = catalog.flavorsById.get(flavorId);
    const isDuplicate = components.some((component) => component.flavorId === flavorId);
    if (!flavor || !isIngredient(flavor) || isDuplicate || share < SHARE_STEP || share % SHARE_STEP !== 0) {
      return null;
    }
    components.push({ flavorId, share });
  }
  if (components.reduce((sum, component) => sum + component.share, 0) !== TOTAL_SHARE) {
    return null;
  }
  const tier = TIERS.has(params.get('tier')) ? params.get('tier') : DEFAULT_TIER;
  const query = (params.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
  return { mix: { tier, components: [...components].sort((left, right) => right.share - left.share) }, query };
}

export function mixShareText(mix, catalog, lang) {
  const text = mix.components
    .map(({ flavorId, share }) => `${flavorLabel(catalog.flavorsById.get(flavorId), lang)} ${share}%`)
    .join(' · ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} — Hookah Mixer`;
}

export function mixFlavorQuery(mix, catalog, lang) {
  const labels = mix.components
    .filter(({ flavorId }) => flavorId !== 'cooling')
    .map(({ flavorId }) => flavorLabel(catalog.flavorsById.get(flavorId), lang));
  const text = labels.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
