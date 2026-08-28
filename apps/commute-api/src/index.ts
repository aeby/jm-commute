import { loadCommuteRuntime } from '@jm/commute/node';

import { readCommuteApiConfig } from './config.js';
import { createCommuteApiServer } from './server.js';

const config = readCommuteApiConfig();
const runtime = await loadCommuteRuntime();
const server = createCommuteApiServer({ runtime, config });

server.listen(config.port, config.host, () => {
  console.info(
    `[commute-api] Listening at http://${config.host}:${config.port}`,
  );
});

function closeServer(signal: NodeJS.Signals): void {
  console.info(`[commute-api] Received ${signal}; shutting down.`);
  server.close((error) => {
    if (error !== undefined) {
      console.error('[commute-api] Shutdown failed.', error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', closeServer);
process.once('SIGTERM', closeServer);
