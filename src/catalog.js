import { buildTermIndex } from './flavors.js';

const CATALOG_FILES = {
  flavors: 'flavors.json',
  graph: 'graph.json',
  concepts: 'concepts.json',
};

export function createCatalog({ flavors, graph, concepts }) {
  return {
    flavors,
    graph,
    concepts,
    flavorsById: new Map(flavors.map((flavor) => [flavor.id, flavor])),
    termIndex: buildTermIndex(flavors),
  };
}

export async function loadCatalog(dataUrl, fetchImpl = fetch) {
  const entries = await Promise.all(Object.entries(CATALOG_FILES).map(async ([key, fileName]) => {
    const response = await fetchImpl(`${dataUrl}/${fileName}`);
    if (!response.ok) {
      throw new Error(`Failed to load ${dataUrl}/${fileName}: HTTP ${response.status}`);
    }
    return [key, await response.json()];
  }));
  return createCatalog(Object.fromEntries(entries));
}
