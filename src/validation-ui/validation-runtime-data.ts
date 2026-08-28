import { PROJECT_CONFIG } from '../config';
import type {
  LocalityRoutingEntry,
  LocalityRoutingIndex,
} from '../transit/locality-routing';
import type { SwissCommuteValidationData } from './validation-data';

export function validateValidationData(
  data: SwissCommuteValidationData | undefined,
): SwissCommuteValidationData {
  const scenario = PROJECT_CONFIG.transit.referenceScenario;
  if (data === undefined) {
    throw new Error(
      'validation-data.js did not define the expected global dataset.',
    );
  }
  if (data.schemaVersion !== 1) {
    throw new Error(`Unsupported validation data schema ${data.schemaVersion}.`);
  }
  if (
    data.serviceDate !== scenario.serviceDate ||
    data.routingWindowStart !== scenario.morningWindow.start ||
    data.routingWindowEnd !== scenario.morningWindow.end
  ) {
    throw new Error(
      'Generated validation data does not match PROJECT_CONFIG. Rebuild it.',
    );
  }
  if (data.feedVersion.length === 0) {
    throw new Error('Generated validation data has no feed version.');
  }
  return data;
}

export function createValidationLocalityRoutingIndex(
  data: SwissCommuteValidationData,
): LocalityRoutingIndex {
  const localityById = new Map(
    data.localities.map((locality) => [locality.localityId, locality]),
  );
  const entries = data.localityRoutingEntries.map(
    (entry): LocalityRoutingEntry => {
      const locality = localityById.get(entry.localityId);
      if (locality === undefined) {
        throw new Error(
          `Routing entry "${entry.localityId}" has no locality metadata.`,
        );
      }
      return {
        localityId: entry.localityId,
        postalCode: locality.postalCode,
        city: locality.city,
        selectionMode: entry.selectionMode,
        stopIndexes: Uint32Array.from(entry.stopIndexes),
      };
    },
  );
  return { entries };
}
