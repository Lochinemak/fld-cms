import Bowser from 'bowser';

/** The brands of a Sec-CH-UA header: `"Brave";v="157", "Chromium";v="157"`. */
function brandsOf(header: string): Bowser.ClientHints['brands'] {
  return Array.from(
    header.matchAll(/"((?:[^"\\]|\\.)*)"\s*;\s*v="([^"]*)"/g),
    ([, brand, version]) => ({ brand: brand!.replace(/\\(.)/g, '$1'), version: version! }),
  );
}

/**
 * A browser and system as people name them: 「Brave · macOS」. From the user agent and, when the
 * request had one, its Sec-CH-UA header (`brands`): the user agent of Brave says Chrome.
 */
export function describeUserAgent(userAgent: string | null, brands: string | null): string {
  if (!userAgent) {
    return '未知设备';
  }
  const { browser, os } = Bowser.parse(
    userAgent,
    brands ? { brands: brandsOf(brands) } : undefined,
  );
  return [browser.name, os.name].filter(Boolean).join(' · ') || userAgent.slice(0, 40);
}
