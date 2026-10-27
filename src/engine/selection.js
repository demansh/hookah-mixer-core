import { isIngredient } from '../flavors.js';

export const MAX_REQUIRED_FLAVORS = 3;
export const MAX_SELECTION_WEIGHT = 3;

const SELECTION_FIELDS = ['concepts', 'flavors', 'properties', 'required', 'excluded'];

export class SelectionError extends Error {
  constructor(issues) {
    super(`Invalid selection: ${issues.join('; ')}`);
    this.name = 'SelectionError';
    this.issues = issues;
  }
}

export function normalizeSelection(selection, catalog) {
  const issues = [];
  if (selection === null || typeof selection !== 'object' || Array.isArray(selection)) {
    throw new SelectionError(['selection must be an object']);
  }
  Object.keys(selection)
    .filter((field) => !SELECTION_FIELDS.includes(field))
    .forEach((field) => issues.push(`unknown field "${field}"`));

  const conceptIds = new Set(catalog.concepts.map((concept) => concept.id));
  const isIngredientId = (id) => isIngredient(catalog.flavorsById.get(id) ?? {});
  const isPropertyId = (id) => catalog.flavorsById.get(id)?.kind === 'property';

  const normalized = {
    concepts: readWeights(selection, 'concepts', (id) => conceptIds.has(id), 'concept', issues),
    flavors: readWeights(selection, 'flavors', isIngredientId, 'flavor', issues),
    properties: readWeights(selection, 'properties', isPropertyId, 'property', issues),
    required: readIds(selection, 'required', isIngredientId, issues),
    excluded: readIds(selection, 'excluded', isIngredientId, issues).sort(),
  };
  if (normalized.required.length > MAX_REQUIRED_FLAVORS) {
    issues.push(`required: at most ${MAX_REQUIRED_FLAVORS} flavors`);
  }
  const conflicts = normalized.required.filter((id) => normalized.excluded.includes(id));
  if (conflicts.length > 0) {
    issues.push(`required and excluded at the same time: ${conflicts.join(', ')}`);
  }
  if (issues.length > 0) {
    throw new SelectionError(issues);
  }
  return normalized;
}

export function selectionKey(normalizedSelection) {
  return JSON.stringify(normalizedSelection);
}

export function selectionContributions(selection) {
  return [
    ...Object.entries(selection.concepts).map(([id, weight]) => ({ type: 'concept', id, weight })),
    ...Object.entries(selection.properties).map(([id, weight]) => ({ type: 'property', id, weight })),
    ...Object.entries(selection.flavors).map(([id, weight]) => ({ type: 'flavor', id, weight })),
    ...selection.required.map((id) => ({ type: 'required', id })),
  ];
}

export function buildProfile(contributions, excludedIds, catalog) {
  const conceptsById = new Map(catalog.concepts.map((concept) => [concept.id, concept]));
  const isProperty = (id) => catalog.flavorsById.get(id)?.kind === 'property';
  const weights = new Map();
  const properties = new Map();
  const requested = [];
  const excluded = new Set(excludedIds);
  const avoid = new Set();
  const raiseWeight = (map, id, weight) => {
    map.set(id, Math.max(map.get(id) ?? 0, weight));
  };

  contributions.forEach(({ type, id, weight }) => {
    if (type === 'concept') {
      const concept = conceptsById.get(id);
      Object.entries(concept.tags).forEach(([tagId, tagWeight]) => {
        raiseWeight(isProperty(tagId) ? properties : weights, tagId, tagWeight * weight);
      });
      concept.avoid.forEach((tagId) => avoid.add(tagId));
    } else if (type === 'property') {
      raiseWeight(properties, id, weight);
    } else if (type === 'flavor') {
      raiseWeight(weights, id, weight);
    } else {
      raiseWeight(weights, id, 1);
      if (!requested.includes(id)) {
        requested.push(id);
      }
    }
  });

  excluded.forEach((id) => weights.delete(id));
  const contradictions = requested.filter((id) => excluded.has(id));
  const required = requested.filter((id) => !excluded.has(id)).slice(0, MAX_REQUIRED_FLAVORS);
  required.forEach((id) => avoid.delete(id));

  return {
    weights,
    properties,
    required,
    excluded,
    avoid,
    contradictions,
    isEmpty: weights.size === 0 && properties.size === 0,
  };
}

function readWeights(selection, field, isKnown, kind, issues) {
  const value = selection[field] ?? {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    issues.push(`${field} must be an object { id: weight }`);
    return {};
  }
  const entries = Object.entries(value).filter(([id, weight]) => {
    if (!isKnown(id)) {
      issues.push(`${field}: unknown ${kind} "${id}"`);
      return false;
    }
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0 || weight > MAX_SELECTION_WEIGHT) {
      issues.push(`${field}.${id}: weight must be a number in (0, ${MAX_SELECTION_WEIGHT}]`);
      return false;
    }
    return true;
  });
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function readIds(selection, field, isKnown, issues) {
  const value = selection[field] ?? [];
  if (!Array.isArray(value)) {
    issues.push(`${field} must be an array of flavor ids`);
    return [];
  }
  const ids = [];
  value.forEach((id) => {
    if (!isKnown(id)) {
      issues.push(`${field}: unknown flavor "${id}"`);
    } else if (ids.includes(id)) {
      issues.push(`${field}: duplicate "${id}"`);
    } else {
      ids.push(id);
    }
  });
  return ids;
}
