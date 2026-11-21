import { afterEach, describe, expect, it, vi } from 'vitest';
import { isInAppBrowser } from '../src/app/i/[token]/recorder';

const as = (userAgent: string) => vi.stubGlobal('navigator', { userAgent });
afterEach(() => vi.unstubAllGlobals());

describe('in-app browser detection (candidates told to open the link in Chrome/Safari)', () => {
  it.each([
    ['Facebook on Android', 'Mozilla/5.0 (Linux; Android 13; SM-A145F Build/TP1A; wv) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0]'],
    ['Instagram on iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 312.0'],
    ['Android WebView', 'Mozilla/5.0 (Linux; Android 12; Redmi Note 10; wv) AppleWebKit/537.36 Version/4.0 Chrome/119 Mobile Safari/537.36'],
  ])('flags %s', (_name, ua) => { as(ua); expect(isInAppBrowser()).toBe(true); });

  it.each([
    ['Chrome on Android', 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'],
    ['Safari on iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Version/17.1 Mobile/15E148 Safari/604.1'],
    ['Chrome on a laptop', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'],
  ])('does not flag %s', (_name, ua) => { as(ua); expect(isInAppBrowser()).toBe(false); });
});
