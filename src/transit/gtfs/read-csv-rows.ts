import { createReadStream } from 'node:fs';

import { parse } from 'csv-parse';

export type CsvColumnIndexes = ReadonlyMap<string, number>;

export function readCsvColumn(
  row: readonly string[],
  columnIndexes: CsvColumnIndexes,
  column: string,
): string {
  const index = columnIndexes.get(column);

  if (index === undefined) {
    throw new Error(`Missing internal CSV column index for "${column}".`);
  }

  return row[index] ?? '';
}

export function readOptionalCsvColumn(
  row: readonly string[],
  columnIndexes: CsvColumnIndexes,
  column: string,
): string | undefined {
  const index = columnIndexes.get(column);

  return index === undefined ? undefined : (row[index] ?? '');
}

export function readNonemptyCsvId(
  row: readonly string[],
  columnIndexes: CsvColumnIndexes,
  column: string,
): string {
  const value = readCsvColumn(row, columnIndexes, column);

  if (value.trim().length === 0) {
    throw new Error(`Column "${column}" must contain a nonempty string ID.`);
  }

  return value;
}

function requireCsvRow(record: unknown): readonly string[] {
  if (!Array.isArray(record)) {
    throw new Error('CSV parser returned a non-array record.');
  }

  return record as string[];
}

function createCsvColumnIndexes(
  header: readonly string[],
  requiredColumns: readonly string[],
): CsvColumnIndexes {
  const missingColumns = requiredColumns.filter(
    (column) => !header.includes(column),
  );

  if (missingColumns.length > 0) {
    throw new Error(
      `Missing required column(s): ${missingColumns.join(', ')}.`,
    );
  }

  return new Map(header.map((column, index) => [column, index]));
}

export async function processGtfsCsvRows(
  path: string,
  requiredColumns: readonly string[],
  processRow: (
    row: readonly string[],
    columnIndexes: CsvColumnIndexes,
    rowNumber: number,
  ) => void | Promise<void>,
): Promise<number> {
  const input = createReadStream(path);
  const parser = parse({
    bom: true,
    delimiter: ',',
    skip_empty_lines: true,
  });
  let currentRowNumber = 0;
  let dataRowCount = 0;
  let columnIndexes: CsvColumnIndexes | undefined;

  input.once('error', (error) => parser.destroy(error));
  input.pipe(parser);

  try {
    for await (const record of parser) {
      currentRowNumber += 1;
      const row = requireCsvRow(record);

      if (columnIndexes === undefined) {
        columnIndexes = createCsvColumnIndexes(row, requiredColumns);
        continue;
      }

      const rowResult = processRow(row, columnIndexes, currentRowNumber);

      if (rowResult !== undefined) {
        await rowResult;
      }

      dataRowCount += 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const rowDescription =
      currentRowNumber === 0 ? '' : ` at row ${currentRowNumber}`;

    throw new Error(`Unable to process ${path}${rowDescription}: ${message}`, {
      cause: error,
    });
  } finally {
    input.destroy();
    parser.destroy();
  }

  if (currentRowNumber === 0) {
    throw new Error(`${path} is empty.`);
  }

  return dataRowCount;
}
