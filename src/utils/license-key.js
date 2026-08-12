import { LICENSE_ALPHABET, LICENSE_KEY_PATTERN } from "../config/constants.js";

export function normalizeLicenseKey(value) {
  if (typeof value !== "string") {
    return null;
  }
  const compact = value.trim().toUpperCase().replace(/[\s-]+/g, "");
  if (compact.length !== 19 || !compact.startsWith("VCN")) {
    return null;
  }
  const randomPart = compact.slice(3);
  if (!/^[A-HJ-NP-Z]{16}$/.test(randomPart)) {
    return null;
  }
  const normalized = [
    "VCN",
    randomPart.slice(0, 4),
    randomPart.slice(4, 8),
    randomPart.slice(8, 12),
    randomPart.slice(12, 16)
  ].join("-");
  return LICENSE_KEY_PATTERN.test(normalized) ? normalized : null;
}
export function generateLicenseKey() {
  const characters = [];
  while (characters.length < 16) {
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    for (const value of randomBytes) {
      if (value >= 240) {
        continue;
      }
      characters.push(
        LICENSE_ALPHABET[value % LICENSE_ALPHABET.length]
      );
      if (characters.length === 16) {
        break;
      }
    }
  }
  const groups = [];
  for (let index = 0; index < characters.length; index += 4) {
    groups.push(characters.slice(index, index + 4).join(""));
  }
  return `VCN-${groups.join("-")}`;
}
