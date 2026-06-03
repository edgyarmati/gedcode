export function isWindowsDrivePath(value: string): boolean {
  return /^[a-zA-Z]:([/\\]|$)/.test(value);
}

export function isUncPath(value: string): boolean {
  return value.startsWith("\\\\");
}

export function isWindowsAbsolutePath(value: string): boolean {
  return isUncPath(value) || isWindowsDrivePath(value);
}

export function isExplicitRelativePath(value: string): boolean {
  return (
    value === "." ||
    value === ".." ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith(".\\") ||
    value.startsWith("..\\")
  );
}

export function isPathInsideDotDirectory(value: string): boolean {
  const hasTrailingSeparator = /[\\/]$/.test(value);
  const segments = value.split(/[\\/]+/).filter((segment) => segment.length > 0);

  return segments.some((segment, index) => {
    const hasChild = index < segments.length - 1 || hasTrailingSeparator;
    return hasChild && segment.startsWith(".") && segment !== "." && segment !== "..";
  });
}
