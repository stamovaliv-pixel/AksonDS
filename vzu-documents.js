/* Общие правила чтения номеров ВзУ из комментария записи. */
(function () {
  'use strict';

  const VZU_SEQUENCE_PATTERN = /(?:^|[^А-ЯЁа-яёA-Za-z0-9])взу\s*[-–—:]?\s*(?:№\s*)?(\d+(?:[\s,;]+\d+)*)/giu;
  const VZU_NUMBER_PATTERN = /(?:^|[^А-ЯЁа-яёA-Za-z0-9])взу\s*[-–—:]?\s*(?:№\s*)?\d+/iu;

  function extractNumbers(comment) {
    const source = String(comment || '');
    const matcher = new RegExp(VZU_SEQUENCE_PATTERN.source, VZU_SEQUENCE_PATTERN.flags);
    const numbers = [];
    let match;
    while ((match = matcher.exec(source)) !== null) {
      const found = String(match[1] || '').match(/\d+/g) || [];
      found.forEach((number) => numbers.push(number));
      if (!match[0].length) matcher.lastIndex += 1;
    }
    return [...new Set(numbers)];
  }

  function hasVzuNumber(comment) {
    return VZU_NUMBER_PATTERN.test(String(comment || ''));
  }

  function matchesSearch(comment, searchValue) {
    const numbers = extractNumbers(comment);
    if (!numbers.length) return false;
    const search = String(searchValue || '').trim();
    if (!search) return true;
    const requestedNumber = search.replace(/\D/g, '');
    return requestedNumber ? numbers.includes(requestedNumber) : false;
  }

  window.DockSlotVzuDocuments = Object.freeze({ extractNumbers, hasVzuNumber, matchesSearch });
})();
