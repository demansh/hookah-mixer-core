export const CORE_VERSION = '0.1.0';

export { createCatalog, loadCatalog } from './catalog.js';
export { recommend, noteForMix, MIXES_PER_PAGE } from './engine/recommend.js';
export { parseQuery, MAX_REQUIRED_FLAVORS } from './engine/profile.js';
export { removeSpans } from './engine/text.js';
export { createSessionSeed } from './engine/random.js';
export { isIngredient, flavorLabel } from './flavors.js';
export { mixToParams, parseMixParams, mixShareText, mixFlavorQuery } from './mix-link.js';
