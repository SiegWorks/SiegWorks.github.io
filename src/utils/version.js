export function parseVersion(value) {
  const core = value.split("-", 1)[0];
  const parts = core.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const numbers = parts.map((part) => Number.parseInt(part, 10));
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) {
    return null;
  }
  return numbers;
}
export function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) {
    throw new Error("Invalid version format.");
  }
  for (let index = 0; index < 3; index++) {
    if (leftParts[index] < rightParts[index]) {
      return -1;
    }
    if (leftParts[index] > rightParts[index]) {
      return 1;
    }
  }
  return 0;
}
