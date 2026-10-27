export const CORE_VERSION = '0.2.0';

export { createCatalog, loadCatalog } from './catalog.js';
export { recommend, recommendSelection, noteForMix, MIXES_PER_PAGE } from './engine/recommend.js';
export { parseQuery } from './engine/profile.js';
export { normalizeSelection, SelectionError, MAX_REQUIRED_FLAVORS, MAX_SELECTION_WEIGHT } from './engine/selection.js';
export { removeSpans } from './engine/text.js';
export { createSessionSeed } from './engine/random.js';
export { isIngredient, flavorLabel } from './flavors.js';
export { mixToParams, parseMixParams, mixShareText, mixFlavorQuery } from './mix-link.js';
