import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import {
  allRegularFilesExist,
  decideResumableBuildPreflight,
  findMissingRegularFiles,
  formatElapsed,
  inspectRegularFileSet,
  runCliCommand,
  runCommandStep,
} from '../cli';

describe('command helpers', () => {
  test.each([
    [0, '0s'],
    [59_999, '59s'],
    [60_000, '1m 00s'],
    [125_900, '2m 05s'],
    [3_661_000, '1h 01m'],
  ])('formats %i milliseconds as %s', (milliseconds, expected) => {
    expect(formatElapsed(milliseconds)).toBe(expected);
  });

  test('reports completion only when every output is a regular file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'public-transport-cli-'));
    const firstPath = join(directory, 'first.json');
    const secondPath = join(directory, 'second.ndjson');
    await writeFile(firstPath, '{}\n', 'utf8');

    await expect(
      allRegularFilesExist([firstPath, secondPath]),
    ).resolves.toBe(false);

    await writeFile(secondPath, '{}\n', 'utf8');
    await expect(
      allRegularFilesExist([firstPath, secondPath]),
    ).resolves.toBe(true);

    const nestedDirectory = join(directory, 'not-a-file');
    await mkdir(nestedDirectory);
    await expect(
      allRegularFilesExist([firstPath, nestedDirectory]),
    ).resolves.toBe(false);
  });

  test('distinguishes absent, complete, and incomplete artifact sets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'public-transport-state-'));
    const firstPath = join(directory, 'manifest.json');
    const secondPath = join(directory, 'travel-times.bin');

    await expect(
      inspectRegularFileSet([firstPath, secondPath]),
    ).resolves.toBe('absent');
    await writeFile(firstPath, '{}\n', 'utf8');
    await expect(
      inspectRegularFileSet([firstPath, secondPath]),
    ).resolves.toBe('incomplete');
    await writeFile(secondPath, '', 'utf8');
    await expect(
      inspectRegularFileSet([firstPath, secondPath]),
    ).resolves.toBe('complete');
  });

  test('treats non-file artifact paths as incomplete rather than absent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'command-state-'));
    const firstPath = join(directory, 'manifest.json');
    const secondPath = join(directory, 'travel-times.bin');
    await Promise.all([mkdir(firstPath), mkdir(secondPath)]);

    await expect(
      inspectRegularFileSet([firstPath, secondPath]),
    ).resolves.toBe('incomplete');
  });

  test('lists absent paths and paths that are not regular files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'required-files-'));
    const filePath = join(directory, 'present.json');
    const missingPath = join(directory, 'missing.json');
    const nestedDirectory = join(directory, 'directory');
    await Promise.all([
      writeFile(filePath, '{}\n', 'utf8'),
      mkdir(nestedDirectory),
    ]);

    await expect(
      findMissingRegularFiles([filePath, missingPath, nestedDirectory]),
    ).resolves.toEqual([missingPath, nestedDirectory]);
  });

  test.each([
    [false, 'absent', 'absent', 'build'],
    [false, 'absent', 'complete', 'skip'],
    [false, 'absent', 'incomplete', 'incomplete-publication'],
    [false, 'complete', 'complete', 'resume'],
    [false, 'complete', 'incomplete', 'resume'],
    [false, 'incomplete', 'complete', 'incomplete-work'],
    [true, 'incomplete', 'incomplete', 'build'],
  ] as const)(
    'decides restart=%s, work=%s, publication=%s as %s',
    (restart, work, publication, expected) => {
      expect(
        decideResumableBuildPreflight({ restart, work, publication }),
      ).toBe(expected);
    },
  );

  test('prints stable start and completion lines', async () => {
    const messages: string[] = [];
    const times = [1_000, 3_500];
    const result = await runCommandStep('Build network', () => 42, {
      heartbeatMilliseconds: 60_000,
      log: (message) => messages.push(message),
      now: () => times.shift() as number,
    });

    expect(result).toBe(42);
    expect(messages).toEqual([
      '[start] Build network',
      '[done] Build network (2s)',
    ]);
  });

  test('prints a concise hint for a nested filesystem error', async () => {
    const messages: string[] = [];
    const exitCodes: number[] = [];
    const fileError = Object.assign(new Error('open failed'), {
      code: 'ENOENT',
      path: '/data/processed/matrix.json',
    });

    await runCliCommand(
      () => {
        throw new Error('Unable to load prepared data.', { cause: fileError });
      },
      {
        fileErrorHint: 'Run "npm run example:prepare" first.',
        logError: (message) => messages.push(message),
        setExitCode: (exitCode) => exitCodes.push(exitCode),
      },
    );

    expect(messages).toEqual([
      'Error: Required file not found: "/data/processed/matrix.json".',
      'Hint: Run "npm run example:prepare" first.',
    ]);
    expect(exitCodes).toEqual([1]);
  });

  test('rethrows errors that are not ordinary filesystem failures', async () => {
    await expect(
      runCliCommand(() => {
        throw new Error('Invalid matrix manifest.');
      }),
    ).rejects.toThrow('Invalid matrix manifest.');
  });

  test('prints a line-oriented heartbeat while a step is running', async () => {
    vi.useFakeTimers();
    try {
      const messages: string[] = [];
      let elapsedMilliseconds = 0;
      let finish!: () => void;
      const operation = runCommandStep(
        'Calculate matrix',
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
        {
          heartbeatMilliseconds: 15_000,
          log: (message) => messages.push(message),
          now: () => elapsedMilliseconds,
        },
      );

      elapsedMilliseconds = 15_000;
      await vi.advanceTimersByTimeAsync(15_000);
      elapsedMilliseconds = 17_500;
      finish();
      await operation;

      expect(messages).toEqual([
        '[start] Calculate matrix',
        '[working] Calculate matrix (15s elapsed)',
        '[done] Calculate matrix (17s)',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
