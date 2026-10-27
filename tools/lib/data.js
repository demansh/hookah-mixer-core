import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

export const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = join(ROOT_DIR, 'data');
export const EVAL_DIR = join(DATA_DIR, 'eval');
export const DIST_DIR = join(ROOT_DIR, 'dist');
export const SRC_DIR = join(ROOT_DIR, 'src');

export class Report {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.infos = [];
  }

  error(location, message) {
    this.errors.push(`${location}: ${message}`);
  }

  warn(location, message) {
    this.warnings.push(`${location}: ${message}`);
  }

  info(message) {
    this.infos.push(message);
  }
}

export function normalizeTerm(term) {
  return String(term).trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

export function splitList(value) {
  return value.split('|').map((part) => part.trim()).filter(Boolean);
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let isQuoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (isQuoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        isQuoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      isQuoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => !(cells.length === 1 && cells[0] === ''));
}

export function readCsvRecords(fileName, requiredColumns, report) {
  const path = join(DATA_DIR, fileName);
  if (!existsSync(path)) {
    report.error(fileName, 'file not found');
    return [];
  }
  const [header = [], ...rows] = parseCsv(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  const columns = header.map((column) => column.trim());
  const missingColumns = requiredColumns.filter((column) => !columns.includes(column));
  if (missingColumns.length > 0) {
    report.error(fileName, `missing columns: ${missingColumns.sort().join(', ')}`);
    return [];
  }
  const records = [];
  rows.forEach((cells, index) => {
    const location = `${fileName}:${index + 2}`;
    if (cells.length > columns.length) {
      report.error(location, 'more values than columns (unquoted comma?)');
      return;
    }
    const row = Object.fromEntries(columns.map((column, columnIndex) => [column, (cells[columnIndex] ?? '').trim()]));
    records.push({ location, row });
  });
  return records;
}

export function readYamlFile(fileName, report) {
  const path = join(DATA_DIR, fileName);
  if (!existsSync(path)) {
    report.error(fileName, 'file not found');
    return null;
  }
  try {
    return parseYaml(readFileSync(path, 'utf8'));
  } catch (error) {
    report.error(basename(path), `invalid YAML: ${error.message}`);
    return null;
  }
}
