// Utility to normalize join codes: trims, removes extra spaces, and replaces multiple dashes with a single dash
export function normalizeJoinCode(code: string): string {
  return code
    .trim()
    .replace(/\s+/g, "") // Remove all spaces
    .replace(/-+/g, "-") // Replace multiple dashes with a single dash
    .toUpperCase(); // Optional: force uppercase for consistency
}
