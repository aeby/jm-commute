const SWISS_POSTAL_CODE_PATTERN = /^[0-9]{4}$/;

export function normalizeSwissPostalCode(
  postalCode: string,
): string | undefined {
  const normalizedPostalCode = postalCode.trim();
  return SWISS_POSTAL_CODE_PATTERN.test(normalizedPostalCode)
    ? normalizedPostalCode
    : undefined;
}
