export function normalizeTerm(term) {
  return term.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

export function buildTermIndex(flavors) {
  const termIndex = new Map();
  flavors.forEach((flavor) => {
    const terms = [
      flavor.label.ru,
      flavor.label.en,
      ...flavor.synonyms.ru,
      ...flavor.synonyms.en,
    ];
    terms.forEach((term) => termIndex.set(normalizeTerm(term), flavor.id));
  });
  return termIndex;
}

export function isIngredient(flavor) {
  return flavor.kind === 'flavor';
}

export function flavorLabel(flavor, lang) {
  return flavor.label[lang] || flavor.label.ru || flavor.label.en;
}
