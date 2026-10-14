// Checks a URL from the site before a script navigates to it. The build
// drops each URL that runs script, but a site's own copy of a template
// can skip that check. So the scripts check again at each place that
// follows a URL. Each function takes the base that resolves a relative
// URL, so the module reads no DOM and the shell's tests run it under Node.

// The schemes that run script or carry a document of their own. URL
// reports each protocol in lowercase with its colon.
const SCRIPT_PROTOCOLS: ReadonlySet<string> = new Set(["javascript:", "vbscript:", "data:"]);

// The protocol that the browser's URL parser reads from url, or null when
// url does not parse. The parser lowercases the scheme. It also strips
// the whitespace around the URL and the tabs and newlines inside it. A
// navigation strips them the same way, so neither hides a scheme from
// the check.
function protocolOf(url: string, base: string): string | null {
  try {
    return new URL(url, base).protocol;
  } catch {
    return null;
  }
}

/** Returns url unchanged, or null after a console warning when url names
 *  the javascript:, vbscript:, or data: scheme or does not parse. A
 *  relative url takes the scheme of base, which is the page's location. */
export function safeNavUrl(url: string, base: string): string | null {
  const protocol = protocolOf(url, base);
  if (protocol !== null && !SCRIPT_PROTOCOLS.has(protocol)) return url;
  console.warn("unity: refused to open", url);
  return null;
}

/** Returns url when it resolves against base to an http: or https: page,
 *  or null after a console warning. */
export function webUrl(url: string, base: string): string | null {
  const protocol = protocolOf(url, base);
  if (protocol === "http:" || protocol === "https:") return url;
  console.warn("unity: refused to link", url);
  return null;
}
