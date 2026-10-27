import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EVAL_DIR, Report, normalizeTerm, splitList, readCsvRecords, readYamlFile } from './lib/data.js';

const TAG_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const CONCEPT_ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
export const PROPERTY_CATEGORY = 'property';
const COOLING_ROLE = 'cooling';
const FLAVOR_CATEGORIES = new Set([
  'fruit_tropical', 'fruit_orchard', 'melon', 'citrus', 'berry', 'dessert', 'bakery', 'candy', 'spice',
  'herbal', 'floral', 'tea', 'drink', 'alcohol', 'nut', 'vegetable', 'tobacco', 'cooling',
]);
const TAG_CATEGORIES = new Set([...FLAVOR_CATEGORIES, PROPERTY_CATEGORY]);
const FLAVOR_ROLES = new Set(['base', 'accent', 'support', COOLING_ROLE]);
export const FLAVOR_ATTRIBUTES = { intensity: [1, 5], sweet: [0, 5], sour: [0, 5], fresh: [0, 5] };
const FAMILIARITY_LEVELS = new Set(['classic', 'known', 'rare']);
const CONCEPT_KEYS = new Set(['id', 'chip', 'phrases_ru', 'phrases_en', 'tags', 'avoid']);
const QUERY_TYPES = new Set(['direct', 'compound', 'abstract']);
const LANGS = new Set(['ru', 'en']);
export const SECTIONS = ['tags', 'category_affinity', 'pairings', 'concepts', 'eval'];
const DESCRIPTION_WORDS_MIN = 3;
const DESCRIPTION_WORDS_MAX = 12;

const sorted = (values) => [...values].sort();
const unorderedPair = (first, second) => [first, second].sort().join('|');

function parseInteger(value, location, column, low, high, report) {
  if (!/^-?\d+$/.test(value)) {
    report.error(location, `${column}='${value}' is not an integer`);
    return null;
  }
  const number = Number(value);
  if (number < low || number > high) {
    report.error(location, `${column}=${number} is outside ${low}..${high}`);
    return null;
  }
  return number;
}

function parseAffinity(value, location, report) {
  const affinity = Number(value);
  if (value === '' || Number.isNaN(affinity)) {
    report.error(location, `affinity='${value}' is not a number`);
    return null;
  }
  if (affinity < -1 || affinity > 1) {
    report.error(location, `affinity=${affinity} is outside -1..1`);
    return null;
  }
  return affinity;
}

function checkWeight(value, location, label, report) {
  if (typeof value !== 'number' || value < 0.1 || value > 1) {
    report.error(location, `${label} weight ${JSON.stringify(value)} must be a number in 0.1..1.0`);
  }
}

function validateFlavorAttributes(row, location, report) {
  const attributeColumns = ['role', ...Object.keys(FLAVOR_ATTRIBUTES)];
  if (row.category === PROPERTY_CATEGORY) {
    const filled = attributeColumns.filter((column) => row[column]);
    if (filled.length > 0) {
      report.error(location, `property tags must leave ${filled.join(', ')} empty`);
    }
    return;
  }
  if (!FLAVOR_ROLES.has(row.role)) {
    report.error(location, `role must be one of ${sorted(FLAVOR_ROLES).join(', ')}`);
  }
  if ((row.role === COOLING_ROLE) !== (row.category === 'cooling')) {
    report.error(location, "role 'cooling' is reserved for the cooling category and required there");
  }
  Object.entries(FLAVOR_ATTRIBUTES).forEach(([column, [low, high]]) => {
    if (row[column] === '') {
      report.error(location, `${column} is empty`);
    } else {
      parseInteger(row[column], location, column, low, high, report);
    }
  });
}

function validateTags(report) {
  const columns = ['id', 'category', 'role', ...Object.keys(FLAVOR_ATTRIBUTES), 'ru', 'en',
    'synonyms_ru', 'synonyms_en', 'description_ru', 'description_en'];
  const index = { allIds: new Set(), flavorIds: new Set() };
  const termOwners = new Map();
  const categoryCounts = new Map();
  const roleCounts = new Map();
  const increment = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const { location, row } of readCsvRecords('tags.csv', columns, report)) {
    if (!TAG_ID_PATTERN.test(row.id)) {
      report.error(location, `id '${row.id}' must be lowercase latin, digits and underscores`);
      continue;
    }
    if (index.allIds.has(row.id)) {
      report.error(location, `duplicate id '${row.id}'`);
      continue;
    }
    index.allIds.add(row.id);
    if (!TAG_CATEGORIES.has(row.category)) {
      report.error(location, `unknown category '${row.category}'`);
      continue;
    }
    if (row.category !== PROPERTY_CATEGORY) {
      index.flavorIds.add(row.id);
      increment(roleCounts, row.role);
    }
    increment(categoryCounts, row.category);
    validateFlavorAttributes(row, location, report);
    ['ru', 'en', 'description_ru', 'description_en'].forEach((column) => {
      if (!row[column]) {
        report.error(location, `${column} is empty`);
      }
    });
    ['description_ru', 'description_en'].forEach((column) => {
      const wordCount = row[column].split(/\s+/).filter(Boolean).length;
      if (row[column] && (wordCount < DESCRIPTION_WORDS_MIN || wordCount > DESCRIPTION_WORDS_MAX)) {
        report.warn(location, `${column} has ${wordCount} words, recommended ${DESCRIPTION_WORDS_MIN}..${DESCRIPTION_WORDS_MAX}`);
      }
    });
    [row.ru, row.en, ...splitList(row.synonyms_ru), ...splitList(row.synonyms_en)].filter(Boolean).forEach((term) => {
      const key = normalizeTerm(term);
      termOwners.set(key, new Set([...(termOwners.get(key) ?? []), row.id]));
    });
  }
  sorted(termOwners.keys()).forEach((term) => {
    const owners = termOwners.get(term);
    if (owners.size > 1) {
      report.error('tags.csv', `term '${term}' belongs to several tags: ${sorted(owners).join(', ')}`);
    }
  });
  const formatCounts = (map) => sorted(map.keys()).map((key) => `${key} ${map.get(key)}`).join(', ');
  report.info(`${index.flavorIds.size} flavors + ${index.allIds.size - index.flavorIds.size} properties`);
  report.info(`by category: ${formatCounts(categoryCounts)}`);
  report.info(`by role: ${formatCounts(roleCounts)}`);
  return index;
}

function validateCategoryAffinity(report) {
  const seenPairs = new Set();
  for (const { location, row } of readCsvRecords('category_affinity.csv', ['a', 'b', 'affinity'], report)) {
    const unknown = [row.a, row.b].filter((category) => !FLAVOR_CATEGORIES.has(category));
    if (unknown.length > 0) {
      report.error(location, `unknown flavor category: ${unknown.join(', ')}`);
      continue;
    }
    const pair = unorderedPair(row.a, row.b);
    if (seenPairs.has(pair)) {
      report.error(location, `duplicate category pair ${pair.replace('|', ' + ')}`);
      continue;
    }
    seenPairs.add(pair);
    parseAffinity(row.affinity, location, report);
  }
  const categoryCount = FLAVOR_CATEGORIES.size;
  report.info(`${seenPairs.size} of ${(categoryCount * (categoryCount + 1)) / 2} category pairs defined, the rest default to 0`);
}

function validatePairings(tags, report) {
  const columns = ['a', 'b', 'affinity', 'familiarity', 'note_ru', 'note_en'];
  const seenPairs = new Set();
  const familiarityCounts = {};
  const pairedFlavors = new Set();
  for (const { location, row } of readCsvRecords('pairings.csv', columns, report)) {
    const unknown = [row.a, row.b].filter((flavor) => !tags.flavorIds.has(flavor));
    if (unknown.length > 0) {
      report.error(location, `unknown flavor (or property tag): ${unknown.join(', ')}`);
      continue;
    }
    if (row.a === row.b) {
      report.error(location, 'a flavor cannot pair with itself');
      continue;
    }
    const pair = unorderedPair(row.a, row.b);
    if (seenPairs.has(pair)) {
      report.error(location, `duplicate pair ${pair.replace('|', ' + ')}`);
      continue;
    }
    seenPairs.add(pair);
    pairedFlavors.add(row.a);
    pairedFlavors.add(row.b);
    parseAffinity(row.affinity, location, report);
    if (!FAMILIARITY_LEVELS.has(row.familiarity)) {
      report.error(location, `familiarity must be one of ${sorted(FAMILIARITY_LEVELS).join(', ')}`);
    }
    familiarityCounts[row.familiarity] = (familiarityCounts[row.familiarity] ?? 0) + 1;
    if (Boolean(row.note_ru) !== Boolean(row.note_en)) {
      report.warn(location, 'note is filled in only one language');
    }
  }
  report.info(`${seenPairs.size} pairs; familiarity: ${JSON.stringify(familiarityCounts)}`);
  const unpaired = sorted([...tags.flavorIds].filter((id) => !pairedFlavors.has(id)));
  report.info(`flavors without explicit pairs (${unpaired.length}): ${unpaired.join(', ')}`);
}

function validateConcepts(tags, report) {
  const concepts = readYamlFile('concepts.yaml', report);
  if (concepts === null) {
    return new Set();
  }
  if (!Array.isArray(concepts)) {
    report.error('concepts.yaml', 'top level must be a list');
    return new Set();
  }
  const conceptIds = new Set();
  const phraseOwners = new Map();
  let chipCount = 0;
  concepts.forEach((concept, index) => {
    if (!concept || typeof concept !== 'object' || Array.isArray(concept)) {
      report.error(`concepts.yaml[${index}]`, 'must be a mapping');
      return;
    }
    const conceptId = String(concept.id ?? '');
    const location = `concepts.yaml:${conceptId || index}`;
    if (!CONCEPT_ID_PATTERN.test(conceptId)) {
      report.error(location, 'id must be lowercase latin, digits and hyphens');
      return;
    }
    if (conceptIds.has(conceptId)) {
      report.error(location, `duplicate id '${conceptId}'`);
      return;
    }
    conceptIds.add(conceptId);
    if ('chip' in concept && typeof concept.chip !== 'boolean') {
      report.error(location, 'chip must be true or false');
    }
    if (concept.chip === true) {
      chipCount += 1;
    }
    const unknownKeys = Object.keys(concept).filter((key) => !CONCEPT_KEYS.has(key));
    if (unknownKeys.length > 0) {
      report.warn(location, `unknown keys ignored: ${sorted(unknownKeys).join(', ')}`);
    }
    ['phrases_ru', 'phrases_en'].forEach((key) => {
      const phrases = concept[key] ?? [];
      if (!Array.isArray(phrases)) {
        report.error(location, `${key} must be a list`);
        return;
      }
      phrases.forEach((phrase) => {
        const normalized = normalizeTerm(phrase);
        phraseOwners.set(normalized, new Set([...(phraseOwners.get(normalized) ?? []), conceptId]));
      });
    });
    if (!Array.isArray(concept.phrases_ru) || concept.phrases_ru.length === 0) {
      report.error(location, 'phrases_ru is empty');
    }
    let conceptTags = concept.tags;
    if (!conceptTags || typeof conceptTags !== 'object' || Array.isArray(conceptTags) || Object.keys(conceptTags).length === 0) {
      report.error(location, 'tags must be a non-empty mapping tag: weight');
      conceptTags = {};
    }
    Object.entries(conceptTags).forEach(([tag, weight]) => {
      if (!tags.allIds.has(tag)) {
        report.error(location, `unknown tag '${tag}'`);
      }
      checkWeight(weight, location, `tag '${tag}'`, report);
    });
    (concept.avoid ?? []).forEach((tag) => {
      if (!tags.allIds.has(tag)) {
        report.error(location, `unknown avoid tag '${tag}'`);
      }
      if (tag in conceptTags) {
        report.error(location, `tag '${tag}' is both in tags and avoid`);
      }
    });
  });
  sorted(phraseOwners.keys()).forEach((phrase) => {
    const owners = phraseOwners.get(phrase);
    if (owners.size > 1) {
      report.warn('concepts.yaml', `phrase '${phrase}' is used by several concepts: ${sorted(owners).join(', ')}`);
    }
  });
  report.info(`${conceptIds.size} concepts (${chipCount} shown as example chips), ${phraseOwners.size} phrases`);
  return new Set(phraseOwners.keys());
}

function validateEval(tags, conceptPhrases, report) {
  const seenQueries = new Set();
  const typeCounts = {};
  const langCounts = {};
  const files = existsSync(EVAL_DIR) ? readdirSync(EVAL_DIR).filter((name) => name.endsWith('.jsonl')).sort() : [];
  files.forEach((fileName) => {
    readFileSync(join(EVAL_DIR, fileName), 'utf8').split('\n').forEach((line, index) => {
      if (!line.trim()) {
        return;
      }
      const location = `${fileName}:${index + 1}`;
      let item;
      try {
        item = JSON.parse(line);
      } catch (error) {
        report.error(location, `invalid JSON: ${error.message}`);
        return;
      }
      const query = normalizeTerm(item.q ?? '');
      if (!query) {
        report.error(location, 'q is empty');
        return;
      }
      if (seenQueries.has(query)) {
        report.warn(location, `duplicate query '${query}'`);
      }
      seenQueries.add(query);
      if (!LANGS.has(item.lang)) {
        report.error(location, `lang must be one of ${sorted(LANGS).join(', ')}`);
      }
      if (!QUERY_TYPES.has(item.type)) {
        report.error(location, `type must be one of ${sorted(QUERY_TYPES).join(', ')}`);
      }
      if (!item.must || item.must.length === 0) {
        report.error(location, 'must is empty');
      }
      ['must', 'ok', 'forbid'].forEach((key) => {
        (item[key] ?? []).forEach((tag) => {
          if (!tags.allIds.has(tag)) {
            report.error(location, `unknown tag '${tag}' in ${key}`);
          }
        });
      });
      const overlap = (item.must ?? []).filter((tag) => (item.forbid ?? []).includes(tag));
      if (overlap.length > 0) {
        report.error(location, `tags in both must and forbid: ${sorted(overlap).join(', ')}`);
      }
      if (item.type === 'abstract' && conceptPhrases.has(query)) {
        report.error(location, `abstract query '${query}' copies a concept phrase, eval would measure recall`);
      }
      typeCounts[item.type] = (typeCounts[item.type] ?? 0) + 1;
      langCounts[item.lang] = (langCounts[item.lang] ?? 0) + 1;
    });
  });
  report.info(`${seenQueries.size} eval queries; types: ${JSON.stringify(typeCounts)}; langs: ${JSON.stringify(langCounts)}`);
}

export function collectReports() {
  const reports = Object.fromEntries(SECTIONS.map((section) => [section, new Report()]));
  const tags = validateTags(reports.tags);
  validateCategoryAffinity(reports.category_affinity);
  validatePairings(tags, reports.pairings);
  const conceptPhrases = validateConcepts(tags, reports.concepts);
  validateEval(tags, conceptPhrases, reports.eval);
  return reports;
}

function main() {
  const onlyArguments = process.argv.slice(2).filter((argument) => argument.startsWith('--only=')).map((argument) => argument.slice(7));
  const selected = onlyArguments.length > 0 ? onlyArguments : SECTIONS;
  const unknown = selected.filter((section) => !SECTIONS.includes(section));
  if (unknown.length > 0) {
    console.error(`unknown section: ${unknown.join(', ')}; use one of ${SECTIONS.join(', ')}`);
    process.exitCode = 2;
    return;
  }
  const reports = collectReports();
  selected.forEach((section) => {
    console.log(`== ${section} ==`);
    reports[section].errors.forEach((message) => console.log(`  ERROR ${message}`));
    reports[section].warnings.forEach((message) => console.log(`  WARN  ${message}`));
    reports[section].infos.forEach((message) => console.log(`  INFO  ${message}`));
  });
  const errorCount = selected.reduce((sum, section) => sum + reports[section].errors.length, 0);
  const warningCount = selected.reduce((sum, section) => sum + reports[section].warnings.length, 0);
  console.log(`\n${errorCount} errors, ${warningCount} warnings`);
  process.exitCode = errorCount > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
