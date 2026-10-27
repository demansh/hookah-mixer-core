import { loadBuiltCatalog, allKnownQueries } from './lib/catalog.js';
import { recommend } from '../src/index.js';

const catalog = loadBuiltCatalog();
const queries = allKnownQueries(catalog);
const problems = [];
const randomFallbacks = [];
const startedAt = performance.now();

for (const query of queries) {
  const { profile, mixes } = await recommend({ query }, catalog, 0);
  if (profile.isRandom) {
    randomFallbacks.push(query);
  }
  if (mixes.length < 3) {
    problems.push(`only ${mixes.length} mixes: "${query}"`);
  }
  mixes.forEach((mix) => {
    const total = mix.components.reduce((sum, component) => sum + component.share, 0);
    if (total !== 100) {
      problems.push(`shares sum ${total}: "${query}"`);
    }
    profile.required.forEach((flavorId) => {
      if (!profile.isRandom && !mix.components.some((component) => component.flavorId === flavorId)) {
        problems.push(`required ${flavorId} missing: "${query}"`);
      }
    });
    mix.components.forEach((component) => {
      if (profile.excluded.has(component.flavorId)) {
        problems.push(`excluded ${component.flavorId} leaked: "${query}"`);
      }
    });
  });
}

console.log(`sweep: ${queries.length} queries in ${Math.round(performance.now() - startedAt)} ms`);
console.log(`random fallbacks (expected 0): ${randomFallbacks.length}${randomFallbacks.length ? ` → ${randomFallbacks.join(', ')}` : ''}`);
console.log(problems.length ? `problems (${problems.length}):\n  ${problems.join('\n  ')}` : 'problems: none');
process.exitCode = problems.length > 0 || randomFallbacks.length > 0 ? 1 : 0;
