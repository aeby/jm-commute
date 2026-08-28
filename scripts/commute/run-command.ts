import { spawn } from 'node:child_process';
import {
  mkdtemp,
  open,
  readFile,
  rm,
  type FileHandle,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

export interface RunCommandOptions {
  readonly cwd: string;
  readonly captureOutput?: boolean;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly elapsedMilliseconds: number;
}

interface CaptureFiles {
  readonly directory: string;
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly stdout: FileHandle;
  readonly stderr: FileHandle;
}

function describeCommand(command: string, arguments_: readonly string[]): string {
  return [command, ...arguments_].join(' ');
}

async function createCaptureFiles(): Promise<CaptureFiles> {
  const directory = await mkdtemp(resolve(tmpdir(), 'jm-command-output-'));
  const stdoutPath = resolve(directory, 'stdout');
  const stderrPath = resolve(directory, 'stderr');
  const [stdout, stderr] = await Promise.all([
    open(stdoutPath, 'wx'),
    open(stderrPath, 'wx'),
  ]);
  return { directory, stdoutPath, stderrPath, stdout, stderr };
}

async function closeCaptureFiles(capture: CaptureFiles): Promise<void> {
  await Promise.all([capture.stdout.close(), capture.stderr.close()]);
}

export async function runCommand(
  command: string,
  arguments_: readonly string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  const startedAt = performance.now();
  const capture = options.captureOutput ? await createCaptureFiles() : undefined;

  try {
    const completion = await new Promise<{
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }>((resolveCompletion, reject) => {
      const child = spawn(command, arguments_, {
        cwd: options.cwd,
        env: options.environment ?? process.env,
        stdio: capture === undefined
          ? 'inherit'
          : ['ignore', capture.stdout.fd, capture.stderr.fd],
        shell: false,
      });
      child.once('error', (error) => {
        reject(
          new Error(
            `Unable to start ${describeCommand(command, arguments_)}: ${error.message}`,
            { cause: error },
          ),
        );
      });
      child.once('close', (code, signal) => {
        resolveCompletion({ code, signal });
      });
    });

    if (capture !== undefined) {
      await closeCaptureFiles(capture);
    }
    const [stdout, stderr] = capture === undefined
      ? ['', '']
      : await Promise.all([
          readFile(capture.stdoutPath, 'utf8'),
          readFile(capture.stderrPath, 'utf8'),
        ]);
    const elapsedMilliseconds = performance.now() - startedAt;
    if (completion.code === 0) {
      return { stdout, stderr, elapsedMilliseconds };
    }

    const detail = completion.signal === null
      ? `exit code ${completion.code}`
      : `signal ${completion.signal}`;
    const capturedDetail = capture === undefined
      ? ''
      : `\n${stderr.trim() || stdout.trim()}`;
    throw new Error(
      `${describeCommand(command, arguments_)} failed with ${detail}.${capturedDetail}`,
    );
  } finally {
    if (capture !== undefined) {
      await Promise.allSettled([
        closeCaptureFiles(capture),
        rm(capture.directory, { recursive: true, force: true }),
      ]);
    }
  }
}

