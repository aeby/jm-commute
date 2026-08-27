import { createReadStream } from 'node:fs';

import { parse } from 'csv-parse';

import type { CsvColumnIndexes } from '../../gtfs/read-csv-rows';
import {
  createGtfsTransferColumnIndexes,
  parseGtfsTransferRow,
  requireGtfsTransferCsvRow,
} from './parse-gtfs-transfers';
import type { ParsedGtfsTransfer } from './types';

/** Streams the large Swiss transfers.txt without retaining every row. */
export async function* readGtfsTransfers(
  path: string,
): AsyncGenerator<ParsedGtfsTransfer> {
  const input = createReadStream(path);
  const parser = parse({
    bom: true,
    delimiter: ',',
    skip_empty_lines: true,
  });
  input.once('error', (error) => parser.destroy(error));
  input.pipe(parser);

  let rowNumber = 0;
  let columns: CsvColumnIndexes | undefined;
  try {
    for await (const record of parser) {
      rowNumber += 1;
      const row = requireGtfsTransferCsvRow(record);
      if (columns === undefined) {
        columns = createGtfsTransferColumnIndexes(row);
        continue;
      }
      try {
        yield parseGtfsTransferRow(row, columns);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Invalid transfers.txt row ${rowNumber}: ${message}`,
          { cause: error },
        );
      }
    }
  } finally {
    input.destroy();
    parser.destroy();
  }

  if (rowNumber === 0) {
    throw new Error(`${path} is empty.`);
  }
}
