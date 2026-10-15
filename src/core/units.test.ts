import { expect, test } from 'vitest';
import { formatArea, formatMetres, parseLength } from './units';

test.each([
  ['3.6', 3600],
  ['3.6m', 3600],
  ['3,6', 3600],
  ['3600', 3600],
  ['3600mm', 3600],
  ['810 mm', 810],
  ['12.45', 12450],
  ['0', null],
  ['abc', null],
  ['', null]
])('parseLength(%s)', (text, mm) => expect(parseLength(text)).toBe(mm));

test('formats metres and areas', () => {
  expect(formatMetres(3650)).toBe('3.65');
  expect(formatArea(12_340_000)).toBe('12.3');
});
