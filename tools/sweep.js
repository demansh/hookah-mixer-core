import { loadBuiltCatalog, allKnownQueries } from './lib/catalog.js';
import { recommend, recommendSelection, isIngredient, MAX_SELECTION_WEIGHT } from '../src/index.js';

const catalog = loadBuiltCatalog();
const queries = allKnownQueries(catalog);
const selections = allSelections(catalog);
const problems = [];
const randomFallbacks = [];
const startedAt = performance.now();

for (const query of queries) {
  const result = await recommend({ query }, catalog, 0);
  checkResult(`"${query}"`, result);
  const structured = await recommendSelection(result.profile.selection, catalog, 0);
  if (JSON.stringify(structured.mixes) !== JSON.stringify(result.mixes)) {
    problems.push(`selection from query gives other mixes: "${query}" → ${JSON.stringify(result.profile.selection)}`);
  }
}

for (const selection of selections) {
  checkResult(`selection ${JSON.stringify(selection)}`, await recommendSelection(selection, catalog, 0));
}

console.log(`sweep: ${queries.length} queries + ${selections.length} selections in ${Math.round(performance.now() - startedAt)} ms`);
console.log(`random fallbacks (expected 0): ${randomFallbacks.length}${randomFallbacks.length ? ` → ${randomFallbacks.join(', ')}` : ''}`);
console.log(problems.length ? `problems (${problems.length}):\n  ${problems.join('\n  ')}` : 'problems: none');
process.exitCode = problems.length > 0 || randomFallbacks.length > 0 ? 1 : 0;

function allSelections({ concepts, flavors }) {
  return [
    ...concepts.map((concept) => ({ concepts: { [concept.id]: 1 } })),
    ...flavors.filter((flavor) => flavor.kind === 'property').map((flavor) => ({ properties: { [flavor.id]: MAX_SELECTION_WEIGHT } })),
    ...flavors.filter(isIngredient).map((flavor) => ({ required: [flavor.id] })),
  ];
}

function checkResult(label, { profile, mixes }) {
  if (profile.isRandom) {
    randomFallbacks.push(label);
  }
  if (mixes.length < 3) {
    problems.push(`only ${mixes.length} mixes: ${label}`);
  }
  mixes.forEach((mix) => {
    const total = mix.components.reduce((sum, component) => sum + component.share, 0);
    if (total !== 100) {
      problems.push(`shares sum ${total}: ${label}`);
    }
    profile.required.forEach((flavorId) => {
      if (!profile.isRandom && !mix.components.some((component) => component.flavorId === flavorId)) {
        problems.push(`required ${flavorId} missing: ${label}`);
      }
    });
    mix.components.forEach((component) => {
      if (profile.excluded.has(component.flavorId)) {
        problems.push(`excluded ${component.flavorId} leaked: ${label}`);
      }
    });
  });
}
