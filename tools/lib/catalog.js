import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST_DIR } from './data.js';
import { createCatalog, flavorLabel } from '../../src/index.js';

export function loadBuiltCatalog() {
  const dataDir = join(DIST_DIR, 'data');
  if (!existsSync(join(dataDir, 'flavors.json'))) {
    throw new Error('dist/data is missing — run "npm run build" first');
  }
  const read = (name) => JSON.parse(readFileSync(join(dataDir, `${name}.json`), 'utf8'));
  return createCatalog({ flavors: read('flavors'), graph: read('graph'), concepts: read('concepts') });
}

export function labelOf(catalog, id) {
  const flavor = catalog.flavorsById.get(id);
  return flavor ? flavorLabel(flavor, 'ru') : id;
}

export function formatMix(catalog, mix) {
  return mix.components.map((component) => `${labelOf(catalog, component.flavorId)} ${component.share}%`).join(' · ');
}

export function allKnownQueries(catalog) {
  return [
    ...catalog.flavors.filter((flavor) => flavor.kind === 'flavor').flatMap((flavor) => [flavor.label.ru, flavor.label.en]),
    ...catalog.flavors.filter((flavor) => flavor.kind === 'property').flatMap((flavor) => [flavor.label.ru, flavor.label.en, ...flavor.synonyms.ru]),
    ...catalog.concepts.flatMap((concept) => [...concept.phrases.ru, ...concept.phrases.en]),
  ];
}
