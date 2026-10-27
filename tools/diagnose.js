import { loadBuiltCatalog, labelOf, formatMix } from './lib/catalog.js';
import { parseQuery, recommend, recommendSelection, normalizeSelection } from '../src/index.js';
import { getGraph } from '../src/engine/graph.js';
import { buildPool, generateCandidates } from '../src/engine/mixes.js';
import { buildProfile, selectionContributions } from '../src/engine/selection.js';

const argumentValue = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
};
const pageCount = Number(argumentValue('pages') ?? 1);
const seed = argumentValue('seed') === undefined ? undefined : Number(argumentValue('seed'));
const selectionArgument = argumentValue('selection');
const queries = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));

if (queries.length === 0 && selectionArgument === undefined) {
  console.log('usage: npm run diagnose -- [--pages=N] [--seed=N] "запрос" ["запрос" ...]');
  console.log('       npm run diagnose -- [--pages=N] [--seed=N] --selection=\'{"concepts":{"tropical-fruits":1},"properties":{"sweet":1.5}}\'');
  process.exit(1);
}

const catalog = loadBuiltCatalog();
const graph = getGraph(catalog);
const formatWeights = (map) => [...map.entries()].sort((left, right) => right[1] - left[1]).map(([id, weight]) => `${id}:${weight}`).join(' ') || '—';

const cases = queries.map((query) => ({
  title: `"${query}"`,
  profile: parseQuery(query, catalog),
  load: (page) => recommend({ query, seed }, catalog, page),
}));
if (selectionArgument !== undefined) {
  const selection = parseSelectionArgument(selectionArgument);
  cases.push({
    title: `selection ${JSON.stringify(selection)}`,
    profile: { ...buildProfile(selectionContributions(selection), selection.excluded, catalog), matched: [], selection },
    load: (page) => recommendSelection({ ...selection, seed }, catalog, page),
  });
}

for (const { title, profile, load } of cases) {
  console.log(`\n=== ${title}${seed === undefined ? '' : ` seed=${seed}`}`);
  if (profile.matched.length > 0 || !profile.selection) {
    console.log(`matched:       ${profile.matched.map((match) => `${match.negated ? '-' : ''}${match.type}:${match.id}${match.partial ? '~partial' : ''}`).join(' ') || '— (not understood → random mixes)'}`);
  }
  console.log(`selection:     ${JSON.stringify(profile.selection)}`);
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
    const result = await load(page);
    console.log(`page ${page}:${result.profile.isRandom ? ' (random fallback)' : ''}`);
    result.mixes.forEach((mix) => {
      console.log(`  ${mix.tier.padEnd(8)} ${formatMix(catalog, mix)}${mix.note ? `   // ${mix.note.ru}` : ''}`);
    });
  }
}

function parseSelectionArgument(text) {
  try {
    return normalizeSelection(JSON.parse(text), catalog);
  } catch (error) {
    console.error(`bad --selection: ${error.message}`);
    process.exit(1);
  }
}
