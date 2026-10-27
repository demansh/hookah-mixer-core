import { normalizeTerm } from '../flavors.js';

const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;
const SHORT_TOKEN_LENGTH = 3;
const SHORT_TOKEN_MAX_SUFFIX = 3;
const LONG_TOKEN_MAX_SUFFIX = 5;
const LONG_TOKEN_PREFIX_SLACK = 2;
const ENDING_BACKOFF = 2;
const SOFT_FINAL_LETTERS = new Set(['й', 'ь']);
const CONNECTOR_WORDS = 'со|с|и|а|and|with|&';
const TRAILING_CONNECTOR_PATTERN = new RegExp(`(?:^|[\\s,])((?:${CONNECTOR_WORDS})\\s+)$`, 'iu');
const LEADING_CONNECTOR_PATTERN = new RegExp(`^(?:${CONNECTOR_WORDS})\\s+`, 'iu');
const COMMA_CONNECTOR_PATTERN = new RegExp(`,\\s*(?:${CONNECTOR_WORDS})\\s+`, 'giu');
const EXACT_MATCH_SCORE = 1.1;
const WORD_ENDING_PATTERN = new RegExp(
  '^(?:[ьй])?(?:ов|ев|ин|н|чн|ск|чк|к)?'
  + '(?:ый|ий|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ыми|ими|ом|ем|ей|ую|юю|ах|ях|ам|ям|ами|ями'
  + '|ы|и|а|я|у|ю|е|о|ь|ью|s|es|ies|y|ey|ish)?$',
);
const TIE_BREAK_WEIGHT = 0.01;

export function tokenize(text) {
  return normalizeTerm(text).match(TOKEN_PATTERN) ?? [];
}

export function tokenizeWithSpans(text) {
  return [...text.matchAll(TOKEN_PATTERN)].map((match) => ({
    token: normalizeTerm(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export function removeSpans(text, spans) {
  let result = text;
  [...spans].sort((left, right) => right.start - left.start).forEach(({ start, end }) => {
    const leadingConnector = result.slice(0, start).match(TRAILING_CONNECTOR_PATTERN);
    const cutStart = leadingConnector ? start - leadingConnector[1].length : start;
    result = result.slice(0, cutStart) + result.slice(end);
  });
  return tidyQuery(result);
}

function tidyQuery(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,(\s*,)+/g, ',')
    .replace(COMMA_CONNECTOR_PATTERN, ', ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .replace(LEADING_CONNECTOR_PATTERN, '');
}

export function tokenMatchScore(queryToken, entryToken) {
  if (queryToken === entryToken) {
    return EXACT_MATCH_SCORE;
  }
  if (entryToken.length <= SHORT_TOKEN_LENGTH) {
    const stems = SOFT_FINAL_LETTERS.has(entryToken.at(-1)) ? [entryToken, entryToken.slice(0, -1)] : [entryToken];
    const isShortMatch = queryToken.length <= entryToken.length + SHORT_TOKEN_MAX_SUFFIX
      && stems.some((stem) => queryToken.startsWith(stem) && isWordEnding(queryToken.slice(stem.length)));
    return isShortMatch ? 1 : 0;
  }
  const prefixLength = commonPrefixLength(queryToken, entryToken);
  const requiredPrefix = Math.max(SHORT_TOKEN_LENGTH, entryToken.length - LONG_TOKEN_PREFIX_SLACK);
  const isTooLong = queryToken.length > entryToken.length + LONG_TOKEN_MAX_SUFFIX;
  const hasForeignEnding = !hasWordEndingAfter(queryToken, prefixLength, requiredPrefix);
  if (prefixLength < requiredPrefix || isTooLong || hasForeignEnding) {
    return 0;
  }
  return prefixLength / Math.max(entryToken.length, queryToken.length) + TIE_BREAK_WEIGHT * (prefixLength / entryToken.length);
}

function isWordEnding(remainder) {
  return WORD_ENDING_PATTERN.test(remainder);
}

function hasWordEndingAfter(queryToken, prefixLength, requiredPrefix) {
  const earliestStart = Math.max(requiredPrefix, prefixLength - ENDING_BACKOFF);
  for (let start = prefixLength; start >= earliestStart; start -= 1) {
    if (isWordEnding(queryToken.slice(start))) {
      return true;
    }
  }
  return false;
}

function commonPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) {
    index += 1;
  }
  return index;
}
