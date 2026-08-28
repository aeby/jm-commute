import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const CAR_ENTRY_PATH = resolve(import.meta.dirname, '..', 'index.ts');
const IMPORT_PATTERN = /(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/gu;

function resolveTypeScriptImport(fromPath: string, specifier: string): string {
  const candidate = resolve(dirname(fromPath), specifier);
  for (const path of [`${candidate}.ts`, resolve(candidate, 'index.ts')]) {
    try {
      if (statSync(path).isFile()) {
        return path;
      }
    } catch {
      // Try the next deterministic TypeScript resolution candidate.
    }
  }
  throw new Error(`Unable to resolve ${specifier} from ${fromPath}.`);
}

function collectProductionImportGraph(entryPath: string): readonly string[] {
  const visited = new Set<string>();
  const pending = [entryPath];
  while (pending.length > 0) {
    const path = pending.pop() as string;
    if (visited.has(path)) {
      continue;
    }
    visited.add(path);
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1] as string;
      if (specifier.startsWith('node:')) {
        throw new Error(`Browser car module ${path} imports ${specifier}.`);
      }
      if (specifier.startsWith('.')) {
        pending.push(resolveTypeScriptImport(path, specifier));
      }
    }
  }
  return [...visited];
}

describe('public car production import graph', () => {
  it('contains no preprocessing, Node, or transit dependency', () => {
    const graph = collectProductionImportGraph(CAR_ENTRY_PATH);
    expect(graph.some((path) => path.includes('/car/preprocessing/'))).toBe(false);
    expect(graph.some((path) => path.includes('/transit/'))).toBe(false);
  });
});
