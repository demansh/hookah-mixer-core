import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DIST_DIR, ROOT_DIR, SRC_DIR, Report, splitList, readCsvRecords, readYamlFile } from './lib/data.js';
import { collectReports, FLAVOR_ATTRIBUTES, PROPERTY_CATEGORY } from './validate.js';

const DIST_DATA_DIR = join(DIST_DIR, 'data');
const DIST_JS_DIR = join(DIST_DIR, 'js');

const localized = (ruValue, enValue) => ({ ru: ruValue || enValue, en: enValue || ruValue });
const records = (fileName) => readCsvRecords(fileName, [], new Report()).map(({ row }) => row);

function buildFlavors() {
  return records('tags.csv').map((row) => {
    const isProperty = row.category === PROPERTY_CATEGORY;
    const flavor = {
      id: row.id,
      category: row.category,
      kind: isProperty ? 'property' : 'flavor',
      label: localized(row.ru, row.en),
      synonyms: { ru: splitList(row.synonyms_ru), en: splitList(row.synonyms_en) },
    };
    if (!isProperty) {
      flavor.role = row.role;
      Object.keys(FLAVOR_ATTRIBUTES).forEach((column) => {
        flavor[column] = Number(row[column]);
      });
    }
    return flavor;
  });
}

function buildGraph() {
  return {
    categoryAffinity: records('category_affinity.csv').map((row) => ({ a: row.a, b: row.b, affinity: Number(row.affinity) })),
    pairs: records('pairings.csv').map((row) => ({
      a: row.a,
      b: row.b,
      affinity: Number(row.affinity),
      familiarity: row.familiarity,
      note: row.note_ru || row.note_en ? localized(row.note_ru, row.note_en) : null,
    })),
  };
}

function buildConcepts() {
  return (readYamlFile('concepts.yaml', new Report()) ?? []).map((concept) => ({
    id: concept.id,
    chip: concept.chip ?? false,
    phrases: { ru: concept.phrases_ru ?? [], en: concept.phrases_en ?? [] },
    tags: concept.tags,
    avoid: concept.avoid ?? [],
  }));
}

function writeJson(fileName, payload) {
  const target = join(DIST_DATA_DIR, fileName);
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(payload)}\n`, 'utf8');
  renameSync(temporary, target);
  console.log(`  ${relative(ROOT_DIR, target)}  ${(statSync(target).size / 1024).toFixed(1)} KB`);
}

function checkVersionsMatch() {
  const packageVersion = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf8')).version;
  const coreVersion = /CORE_VERSION = '([^']+)'/.exec(readFileSync(join(SRC_DIR, 'index.js'), 'utf8'))?.[1];
  if (packageVersion !== coreVersion) {
    throw new Error(`package.json version ${packageVersion} differs from CORE_VERSION ${coreVersion} in src/index.js`);
  }
  return packageVersion;
}

function main() {
  const reports = collectReports();
  const errors = Object.values(reports).flatMap((report) => report.errors);
  if (errors.length > 0) {
    console.log('Build aborted, fix validation errors first (npm run validate):');
    errors.forEach((message) => console.log(`  ERROR ${message}`));
    process.exitCode = 1;
    return;
  }
  const version = checkVersionsMatch();
  rmSync(DIST_DIR, { recursive: true, force: true });
  mkdirSync(DIST_DATA_DIR, { recursive: true });
  console.log(`Built hookah-mixer-core ${version}:`);
  writeJson('flavors.json', buildFlavors());
  writeJson('graph.json', buildGraph());
  writeJson('concepts.json', buildConcepts());
  cpSync(SRC_DIR, DIST_JS_DIR, { recursive: true });
  console.log(`  ${relative(ROOT_DIR, DIST_JS_DIR)}/  (copy of src/)`);
  writeFileSync(join(DIST_DIR, 'VERSION'), `${version}\n`, 'utf8');
}

main();
