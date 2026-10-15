export const URL_MAX = 2_000;

export function canonicalizeUrl(value: string): string | null {
  if (value.length > URL_MAX) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  if (!url.hostname || (url.hostname !== "localhost" && !url.hostname.includes("."))) {
    return null;
  }
  if (url.toString().length > URL_MAX) {
    return null;
  }
  return url.toString();
}
