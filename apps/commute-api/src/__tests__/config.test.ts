import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COMMUTE_API_CONFIG,
  readCommuteApiConfig,
} from '../config.js';

describe('readCommuteApiConfig', () => {
  it('uses loopback-only development defaults and the established grid', () => {
    const config = readCommuteApiConfig({});

    expect(config).toEqual(DEFAULT_COMMUTE_API_CONFIG);
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3_001);
    expect(config.corsAllowedOrigins).toEqual([
      'http://127.0.0.1:5173',
      'http://localhost:5173',
    ]);
    expect(config.visualization).toEqual({
      hexCellDiameterMeters: 4_000,
      hexRenderScale: 0.88,
    });
  });

  it('accepts explicit host, port, and one CORS origin', () => {
    const config = readCommuteApiConfig({
      COMMUTE_API_HOST: 'localhost',
      COMMUTE_API_PORT: '4321',
      COMMUTE_API_CORS_ORIGIN: 'http://localhost:5173',
    });

    expect(config.host).toBe('localhost');
    expect(config.port).toBe(4_321);
    expect(config.corsAllowedOrigins).toEqual(['http://localhost:5173']);
  });

  it('allows development CORS to be disabled explicitly', () => {
    expect(
      readCommuteApiConfig({ COMMUTE_API_CORS_ORIGIN: ' ' })
        .corsAllowedOrigins,
    ).toEqual([]);
  });

  it.each(['0', '65536', '30.5', 'not-a-number'])(
    'rejects invalid port %s',
    (port) => {
      expect(() => readCommuteApiConfig({ COMMUTE_API_PORT: port })).toThrow(
        'COMMUTE_API_PORT',
      );
    },
  );

  it('rejects a wildcard CORS configuration', () => {
    expect(() =>
      readCommuteApiConfig({ COMMUTE_API_CORS_ORIGIN: '*' }),
    ).toThrow('one explicit origin');
  });
});
