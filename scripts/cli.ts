import { stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const DEFAULT_HEARTBEAT_MILLISECONDS = 15_000;

export interface CommandStepOptions {
  readonly heartbeatMilliseconds?: number;
  readonly log?: (message: string) => void;
  readonly now?: () => number;
}

export interface CliCommandOptions {
  /** Printed after a recognized filesystem error. */
  readonly fileErrorHint?: string;
  readonly logError?: (message: string) => void;
  readonly setExitCode?: (exitCode: number) => void;
}

export type RegularFileSetState = 'absent' | 'complete' | 'incomplete';

export type ResumableBuildPreflightDecision =
  | 'build'
  | 'resume'
  | 'skip'
  | 'incomplete-work'
  | 'incomplete-publication';

export interface ResumableBuildPreflightState {
  readonly restart: boolean;
  readonly work: RegularFileSetState;
  readonly publication: RegularFileSetState;
}

const FRIENDLY_FILE_ERROR_CODES = new Set([
  'EACCES',
  'EISDIR',
  'EMFILE',
  'ENFILE',
  'ENOENT',
  'ENOSPC',
  'ENOTDIR',
  'EPERM',
  'EROFS',
]);

interface FileSystemError {
  readonly code: string;
  readonly path?: unknown;
}

type RegularFilePathState = 'absent' | 'file' | 'other';

function isUnavailablePathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

async function inspectRegularFile(path: string): Promise<RegularFilePathState> {
  try {
    return (await stat(path)).isFile() ? 'file' : 'other';
  } catch (error) {
    if (isUnavailablePathError(error)) {
      return 'absent';
    }
    throw error;
  }
}

function findFileSystemError(
  error: unknown,
  seen = new Set<unknown>(),
): FileSystemError | undefined {
  if (typeof error !== 'object' || error === null || seen.has(error)) {
    return undefined;
  }
  seen.add(error);

  if (
    'code' in error &&
    typeof error.code === 'string' &&
    FRIENDLY_FILE_ERROR_CODES.has(error.code)
  ) {
    return error as FileSystemError;
  }

  return 'cause' in error
    ? findFileSystemError(error.cause, seen)
    : undefined;
}

function formatFileSystemError(error: FileSystemError): string {
  const path =
    typeof error.path === 'string' && error.path.length > 0
      ? `"${error.path}"`
      : undefined;

  switch (error.code) {
    case 'ENOENT':
      return path === undefined
        ? 'A required file was not found.'
        : `Required file not found: ${path}.`;
    case 'ENOTDIR':
      return path === undefined
        ? 'A required file path is invalid.'
        : `Required file path is invalid: ${path}.`;
    case 'EISDIR':
      return path === undefined
        ? 'Expected a file but found a directory.'
        : `Expected a file but found a directory: ${path}.`;
    case 'EACCES':
    case 'EPERM':
      return path === undefined
        ? 'Cannot access a required file.'
        : `Cannot access required file: ${path}.`;
    case 'ENOSPC':
      return path === undefined
        ? 'Not enough disk space to write the output file.'
        : `Not enough disk space to write ${path}.`;
    case 'EROFS':
      return path === undefined
        ? 'Cannot write the output to a read-only filesystem.'
        : `Cannot write ${path} because its filesystem is read-only.`;
    case 'EMFILE':
    case 'ENFILE':
      return 'Too many files are open; close other processes and try again.';
    default:
      return path === undefined
        ? `Filesystem error ${error.code}.`
        : `Filesystem error ${error.code}: ${path}.`;
  }
}

export function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return `${totalMinutes}m ${String(seconds).padStart(2, '0')}s`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

export async function inspectRegularFileSet(
  paths: readonly string[],
): Promise<RegularFileSetState> {
  if (paths.length === 0) {
    throw new TypeError('At least one output path is required.');
  }
  const results = await Promise.all(paths.map(inspectRegularFile));
  if (results.every((result) => result === 'file')) {
    return 'complete';
  }
  if (results.every((result) => result === 'absent')) {
    return 'absent';
  }
  return 'incomplete';
}

/** Returns paths that are absent or are not regular files. */
export async function findMissingRegularFiles(
  paths: readonly string[],
): Promise<readonly string[]> {
  if (paths.length === 0) {
    throw new TypeError('At least one required file path is required.');
  }

  const availability = await Promise.all(paths.map(inspectRegularFile));

  return paths.filter((_path, index) => availability[index] !== 'file');
}

export async function allRegularFilesExist(
  paths: readonly string[],
): Promise<boolean> {
  return (await inspectRegularFileSet(paths)) === 'complete';
}

export function decideResumableBuildPreflight(
  state: ResumableBuildPreflightState,
): ResumableBuildPreflightDecision {
  if (state.restart) {
    return 'build';
  }
  if (state.work === 'incomplete') {
    return 'incomplete-work';
  }
  if (state.work === 'complete') {
    return 'resume';
  }
  if (state.publication === 'incomplete') {
    return 'incomplete-publication';
  }
  if (state.publication === 'complete') {
    return 'skip';
  }
  return 'build';
}

/**
 * Runs a command without a stack trace for ordinary filesystem failures.
 * Programming and data-validation errors are deliberately rethrown.
 */
export async function runCliCommand(
  action: () => void | Promise<void>,
  options: CliCommandOptions = {},
): Promise<void> {
  try {
    await action();
  } catch (error) {
    const fileError = findFileSystemError(error);
    if (fileError === undefined) {
      throw error;
    }

    const logError = options.logError ?? console.error;
    logError(`Error: ${formatFileSystemError(fileError)}`);
    if (options.fileErrorHint !== undefined) {
      logError(`Hint: ${options.fileErrorHint}`);
    }
    (options.setExitCode ?? ((exitCode) => (process.exitCode = exitCode)))(1);
  }
}

/** Runs a command step with stable line-oriented progress for slow terminals. */
export async function runCommandStep<T>(
  label: string,
  action: () => T | Promise<T>,
  options: CommandStepOptions = {},
): Promise<T> {
  const log = options.log ?? console.log;
  const now = options.now ?? performance.now.bind(performance);
  const heartbeatMilliseconds =
    options.heartbeatMilliseconds ?? DEFAULT_HEARTBEAT_MILLISECONDS;
  if (heartbeatMilliseconds <= 0) {
    throw new RangeError('Command-step heartbeat must be greater than zero.');
  }

  const startedAt = now();
  log(`[start] ${label}`);
  const heartbeat = setInterval(() => {
    log(`[working] ${label} (${formatElapsed(now() - startedAt)} elapsed)`);
  }, heartbeatMilliseconds);
  heartbeat.unref();

  try {
    const result = await action();
    log(`[done] ${label} (${formatElapsed(now() - startedAt)})`);
    return result;
  } catch (error) {
    log(`[failed] ${label} (${formatElapsed(now() - startedAt)})`);
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}
