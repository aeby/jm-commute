const COMBINING_MARKS = /\p{M}+/gu;
const REPEATED_WHITESPACE = /\s+/gu;

export function normalizeCityName(city: string): string {
  return city
    .trim()
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(REPEATED_WHITESPACE, ' ');
}
