import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export interface OsrmServerOptions {
  readonly image: string;
  readonly algorithm: string;
  readonly datasetBasename: string;
  readonly networkDirectory: string;
}

export interface OsrmServerExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface RunningOsrmServer {
  exitStatus(): OsrmServerExit | undefined;
  stop(): Promise<void>;
}

const STOP_TIMEOUT_MILLISECONDS = 15_000;

export function createOsrmServerDockerArguments(
  options: OsrmServerOptions,
  containerName: string,
): readonly string[] {
  return [
    'run',
    '--rm',
    '--name',
    containerName,
    '--network',
    'host',
    '--mount',
    `type=bind,source=${options.networkDirectory},target=/data,readonly`,
    options.image,
    'osrm-routed',
    '--algorithm',
    options.algorithm,
    `/data/${options.datasetBasename}`,
  ];
}

function processExit(child: ChildProcess): Promise<OsrmServerExit> {
  return new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

function runDockerStop(containerName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      'docker',
      ['stop', '--time', '10', containerName],
      { shell: false, stdio: 'ignore' },
    );
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
  });
}

/** Starts the pinned local OSRM service used only for one matrix build. */
export async function startOsrmServer(
  options: OsrmServerOptions,
): Promise<RunningOsrmServer> {
  const containerName = `jm-commute-road-osrm-${process.pid}-${randomUUID()}`;
  const child = spawn(
    'docker',
    createOsrmServerDockerArguments(options, containerName),
    { shell: false, stdio: 'inherit' },
  );
  const exited = processExit(child);
  let status: OsrmServerExit | undefined;
  void exited.then((value) => {
    status = value;
  });

  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', (error) => {
      reject(new Error('Unable to start the OSRM Docker container.', {
        cause: error,
      }));
    });
  });

  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      if (status !== undefined) {
        return;
      }
      if (!(await runDockerStop(containerName)) && status === undefined) {
        child.kill('SIGTERM');
      }
      const stoppedBeforeTimeout = await Promise.race([
        exited.then(() => true),
        delay(STOP_TIMEOUT_MILLISECONDS, undefined, { ref: false }).then(
          () => {
            return false;
          },
        ),
      ]);
      if (!stoppedBeforeTimeout) {
        child.kill('SIGKILL');
        await exited;
      }
    })();
    return stopping;
  };

  return {
    exitStatus: () => status,
    stop,
  };
}
