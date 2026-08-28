const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3_001;
const DEFAULT_DEVELOPMENT_ORIGINS = Object.freeze([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]);

export interface CommuteApiConfig {
  readonly host: string;
  readonly port: number;
  readonly corsAllowedOrigins: readonly string[];
  readonly maxRequestBodyBytes: number;
  readonly visualization: {
    /** Opposite-corner diameter of a logical hex cell in Web Mercator metres. */
    readonly hexCellDiameterMeters: number;
    /** Render-only polygon scale; cell assignment and identity are unchanged. */
    readonly hexRenderScale: number;
  };
}

export const DEFAULT_COMMUTE_API_CONFIG: CommuteApiConfig = Object.freeze({
  host: DEFAULT_HOST,
  port: DEFAULT_PORT,
  corsAllowedOrigins: DEFAULT_DEVELOPMENT_ORIGINS,
  maxRequestBodyBytes: 16 * 1_024,
  visualization: Object.freeze({
    hexCellDiameterMeters: 2_000,
    hexRenderScale: 0.88,
  }),
});

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      'COMMUTE_API_PORT must be an integer between 1 and 65535.',
    );
  }
  return port;
}

/** Read process configuration once during application startup. */
export function readCommuteApiConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CommuteApiConfig {
  const configuredOrigin = environment.COMMUTE_API_CORS_ORIGIN?.trim();
  if (configuredOrigin === '*') {
    throw new Error(
      'COMMUTE_API_CORS_ORIGIN must be one explicit origin, not "*".',
    );
  }
  return {
    ...DEFAULT_COMMUTE_API_CONFIG,
    host: environment.COMMUTE_API_HOST?.trim() || DEFAULT_HOST,
    port: parsePort(environment.COMMUTE_API_PORT),
    corsAllowedOrigins:
      configuredOrigin === '' ? [] :
        configuredOrigin === undefined ? DEFAULT_DEVELOPMENT_ORIGINS :
          [configuredOrigin],
  };
}
