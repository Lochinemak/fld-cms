import { describe, expect, it } from 'vitest';
import { describeUserAgent } from './user-agent';

const CHROME_ON_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
const GREASE = '"Not-A Brand";v="99"';

describe('describeUserAgent', () => {
  it('names the browser and the system', () => {
    expect(describeUserAgent(CHROME_ON_MAC, null)).toBe('Chrome · macOS');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
        null,
      ),
    ).toBe('Firefox · Windows');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
        null,
      ),
    ).toBe('Safari · iOS');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0',
        `"Microsoft Edge";v="157", "Chromium";v="157", ${GREASE}`,
      ),
    ).toBe('Microsoft Edge · Windows');
  });

  it('tells Brave from Chrome by the brands, their user agents being the same', () => {
    expect(describeUserAgent(CHROME_ON_MAC, `"Brave";v="157", "Chromium";v="157", ${GREASE}`)).toBe(
      'Brave · macOS',
    );
    expect(
      describeUserAgent(CHROME_ON_MAC, `"Google Chrome";v="157", "Chromium";v="157", ${GREASE}`),
    ).toBe('Chrome · macOS');
  });

  it('reads brands whose names have quotes, commas and semicolons', () => {
    expect(describeUserAgent(CHROME_ON_MAC, '"Not\\"A;Brand, really";v="8", "Brave";v="157"')).toBe(
      'Brave · macOS',
    );
  });

  it('goes by the user agent when the brands are not a Sec-CH-UA header', () => {
    expect(describeUserAgent(CHROME_ON_MAC, 'nonsense')).toBe('Chrome · macOS');
  });

  it('shows the start of a user agent it does not know, and says when there is none', () => {
    expect(describeUserAgent('audit-test-browser/1.0', null)).toBe('audit-test-browser/1.0');
    expect(describeUserAgent('x'.repeat(60), null)).toBe('x'.repeat(40));
    expect(describeUserAgent(null, null)).toBe('未知设备');
    expect(describeUserAgent('', '"Brave";v="157"')).toBe('未知设备');
  });
});
