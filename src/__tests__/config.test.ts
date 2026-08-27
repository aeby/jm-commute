import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PROJECT_CONFIG } from '../config';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

async function findProductionTypeScriptFiles(
  directory: string,
): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        return entry.name === '__tests__'
          ? []
          : findProductionTypeScriptFiles(path);
      }

      return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
    }),
  );

  return files.flat();
}

describe('PROJECT_CONFIG', () => {
  it('contains the fixed reference scenario and candidate-selection values', () => {
    expect(PROJECT_CONFIG).toEqual({
      transit: {
        referenceScenario: {
          serviceDate: '2026-09-07',
          departureTime: '08:00:00',
          serviceProfileWindow: {
            start: '07:00:00',
            end: '09:00:00',
          },
        },
        candidateSelection: {
          maxAccessDistanceMeters: 700,
          fallbackCandidateCount: 10,
        },
        routing: {
          maxTransfers: 5,
          minTransferTimeSeconds: 120,
        },
      },
    });
  });

  it('uses a Monday for the configured service date', () => {
    const { serviceDate } = PROJECT_CONFIG.transit.referenceScenario;

    expect(new Date(`${serviceDate}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('has removed the former configuration modules', () => {
    expect(
      existsSync(join(PROJECT_ROOT, 'src', 'transit', 'reference-scenario.ts')),
    ).toBe(false);
    expect(
      existsSync(
        join(
          PROJECT_ROOT,
          'src',
          'transit',
          'candidates',
          'configuration.ts',
        ),
      ),
    ).toBe(false);
  });

  it('does not redeclare configured values in production TypeScript', async () => {
    const files = (
      await Promise.all([
        findProductionTypeScriptFiles(join(PROJECT_ROOT, 'src')),
        findProductionTypeScriptFiles(join(PROJECT_ROOT, 'scripts')),
      ])
    )
      .flat()
      .filter((path) => path !== join(PROJECT_ROOT, 'src', 'config.ts'));
    const sources = await Promise.all(files.map((path) => readFile(path, 'utf8')));
    const productionSource = sources.join('\n');

    expect(productionSource).not.toMatch(/['"]2026-09-07['"]/);
    expect(productionSource).not.toMatch(/['"]08:00:00['"]/);
    expect(productionSource).not.toMatch(/['"]07:00:00['"]/);
    expect(productionSource).not.toMatch(/['"]09:00:00['"]/);
    expect(productionSource).not.toMatch(
      /maxAccessDistanceMeters\s*:\s*700/,
    );
    expect(productionSource).not.toMatch(/fallbackCandidateCount\s*:\s*10/);
    expect(productionSource).not.toMatch(/maxTransfers\s*:\s*5/);
    expect(productionSource).not.toMatch(
      /minTransferTimeSeconds\s*:\s*120/,
    );
  });
});
