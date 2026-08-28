import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parseLocalitiesCsv } from '../parse-localities-csv';

const fixtureCsv = readFileSync(
  new URL('./fixtures/localities.csv', import.meta.url),
  'utf8',
);

const REQUIRED_HEADERS = ['Ortschaftsname', 'PLZ4', 'E', 'N'] as const;

describe('parseLocalitiesCsv', () => {
  it('maps the source columns to minimal Locality objects', () => {
    const localities = parseLocalitiesCsv(fixtureCsv);
    const zurich = localities.find(
      ({ postalCode, city }) => postalCode === '8001' && city === 'Zürich',
    );

    expect(localities).toHaveLength(4);
    expect(zurich).toEqual({
      postalCode: '8001',
      city: 'Zürich',
      latitude: 47.3723085057712,
      longitude: 8.542467084010747,
    });
    expect(typeof zurich?.postalCode).toBe('string');
  });

  it('keeps the locality with the highest address share for duplicate keys', () => {
    const localities = parseLocalitiesCsv(fixtureCsv);
    const neuchatel = localities.filter(
      ({ postalCode, city }) => postalCode === '2000' && city === 'Neuchâtel',
    );

    expect(neuchatel).toEqual([
      {
        postalCode: '2000',
        city: 'Neuchâtel',
        latitude: 46.99435482417727,
        longitude: 6.9271155740321095,
      },
    ]);
  });

  it('supports an optional UTF-8 BOM', () => {
    expect(parseLocalitiesCsv(`\uFEFF${fixtureCsv}`)).toEqual(
      parseLocalitiesCsv(fixtureCsv),
    );
  });

  it('keeps the first duplicate when the address-share column is absent', () => {
    const csv = [
      'Ortschaftsname;PLZ4;E;N',
      'Bern;3000;7.44;46.94',
      'Bern;3000;7.45;46.95',
    ].join('\n');

    expect(parseLocalitiesCsv(csv)).toEqual([
      {
        postalCode: '3000',
        city: 'Bern',
        latitude: 46.94,
        longitude: 7.44,
      },
    ]);
  });

  it.each(REQUIRED_HEADERS)(
    'reports a missing required %s header',
    (missingHeader) => {
      const headers = REQUIRED_HEADERS.filter(
        (header) => header !== missingHeader,
      );
      const csv = `${headers.join(';')}\n${headers.map(() => 'value').join(';')}`;

      expect(() => parseLocalitiesCsv(csv)).toThrow(
        new RegExp(`missing required column.*${missingHeader}`, 'i'),
      );
    },
  );

  it.each([
    ['E', 'not-a-coordinate'],
    ['N', 'Infinity'],
    ['E', '181'],
    ['N', '-91'],
  ])('reports a malformed %s coordinate', (column, value) => {
    const longitude = column === 'E' ? value : '8.54';
    const latitude = column === 'N' ? value : '47.37';
    const csv = [
      'Ortschaftsname;PLZ4;E;N',
      `Zürich;8001;${longitude};${latitude}`,
    ].join('\n');

    expect(() => parseLocalitiesCsv(csv)).toThrow(
      new RegExp(`malformed WGS84 .*"${column}"`, 'i'),
    );
  });

  it('reports a missing required row field', () => {
    const csv = ['Ortschaftsname;PLZ4;E;N', 'Zürich;8001;;47.37'].join(
      '\n',
    );

    expect(() => parseLocalitiesCsv(csv)).toThrow(
      /missing required field "E"/i,
    );
  });
});
