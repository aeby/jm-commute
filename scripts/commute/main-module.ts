import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function isMainModule(moduleUrl: string): boolean {
  const entryPath = process.argv[1];
  return entryPath !== undefined &&
    moduleUrl === pathToFileURL(resolve(entryPath)).href;
}

