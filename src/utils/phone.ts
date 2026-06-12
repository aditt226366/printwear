export function normalizePhoneNumber(value: string | number | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  let digits = String(value).replace(/\D/g, "");

  if (digits.length === 10) {
    digits = `91${digits}`;
  }

  if (digits.length < 10 || digits.length > 15) {
    return null;
  }

  return digits;
}
