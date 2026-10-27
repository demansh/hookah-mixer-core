import { loadBuiltCatalog, labelOf, formatMix } from './lib/catalog.js';
import { parseQuery, recommend } from '../src/index.js';
import { getGraph } from '../src/engine/graph.js';
import { buildPool, generateCandidates } from '../src/engine/mixes.js';

const argumentValue = (name) => process.argv.find((argument) => argument.startsWith(`--${name}=`))?.split('=')[1];
const pageCount = Number(argumentValue('pages') ?? 1);
const seed = argumentValue('seed') === undefined ? undefined : Number(argumentValue('seed'));
const queries = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));

if (queries.length === 0) {
  console.log('usage: npm run diagnose -- [--pages=N] [--seed=N] "запрос" ["запрос" ...]');
  process.exit(1);
}

const catalog = loadBuiltCatalog();
const graph = getGraph(catalog);
const formatWeights = (map) => [...map.entries()].sort((left, right) => right[1] - left[1]).map(([id, weight]) => `${id}:${weight}`).join(' ') || '—';

for (const query of queries) {
  const profile = parseQuery(query, catalog);
  console.log(`\n=== "${query}"${seed === undefined ? '' : ` seed=${seed}`}`);
  console.log(`matched:       ${profile.matched.map((match) => `${match.negated ? '-' : ''}${match.type}:${match.id}${match.partial ? '~partial' : ''}`).join(' ') || '— (not understood → random mixes)'}`);
  console.log(`weights:       ${formatWeights(profile.weights)}`);
  console.log(`properties:    ${formatWeights(profile.properties)}`);
  console.log(`required:      ${profile.required.join(' ') || '—'}   excluded: ${[...profile.excluded].join(' ') || '—'}   avoid: ${[...profile.avoid].join(' ') || '—'}`);
  if (profile.contradictions.length > 0) {
    console.log(`contradictions: ${profile.contradictions.join(' ')}`);
  }
  if (!profile.isEmpty) {
    const pool = buildPool(profile, catalog, graph);
    const candidates = generateCandidates(pool, profile, catalog, graph);
    console.log(`pool:          ${pool.optionalIds.length} optional [${pool.optionalIds.map((id) => labelOf(catalog, id)).join(', ')}]`);
    console.log(`               core=${[...pool.coreIds].join(',') || '—'} cooling=${pool.coolingPolicy} candidates=${candidates.length}`);
  }
  for (let page = 0; page < pageCount; page += 1) {
    const result = await recommend({ query, seed }, catalog, page);
    console.log(`page ${page}:${result.profile.isRandom ? ' (random fallback)' : ''}`);
    result.mixes.forEach((mix) => {
      console.log(`  ${mix.tier.padEnd(8)} ${formatMix(catalog, mix)}${mix.note ? `   // ${mix.note.ru}` : ''}`);
    });
  }
}
