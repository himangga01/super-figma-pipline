import { describe, expect, it } from 'vitest';

import {
  isGlobalRemoteAddress,
  validateRemoteImagePolicy,
  vetRemoteAddresses,
  REMOTE_IMAGE_LIMITS,
  type RemoteImagePolicy,
} from '../../src/network/remote-image-fetcher.js';

const policy = (overrides: Partial<RemoteImagePolicy> = {}): RemoteImagePolicy => ({
  allowedDomains: ['assets.example.com'],
  maxRedirects: 3,
  maxBytes: REMOTE_IMAGE_LIMITS.maxDecodedBytes,
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  ...overrides,
});

describe('remote DNS pinning', () => {
  it.each([
    ['8.8.8.8', 4],
    ['1.1.1.1', 4],
    ['2606:4700:4700::1111', 6],
    ['2001:4860:4860::8888', 6],
  ] as const)('accepts global address %s', (address, family) => {
    expect(isGlobalRemoteAddress(address, family)).toBe(true);
    expect(vetRemoteAddresses([{ address, family }])).toEqual([{ address, family }]);
  });

  it.each(['100:0:0:1::1', '4000::1', '8000::1', 'e000::1', '1fff:ffff::1'])(
    'rejects IPv6 outside global-unicast 2000::/3: %s',
    address => {
      expect(isGlobalRemoteAddress(address, 6)).toBe(false);
      expect(() => vetRemoteAddresses([{ address, family: 6 }])).toThrowError(
        expect.objectContaining({ code: 'REMOTE_ADDRESS_DENIED' }),
      );
    },
  );

  it.each(['2000::1', '3ffe:ffff::1'])(
    'admits non-special global-unicast boundary address %s',
    address => {
      expect(isGlobalRemoteAddress(address, 6)).toBe(true);
    },
  );

  it.each([
    ['0.0.0.0', 4],
    ['10.0.0.1', 4],
    ['100.64.0.1', 4],
    ['127.0.0.1', 4],
    ['169.254.1.1', 4],
    ['172.16.0.1', 4],
    ['192.0.0.1', 4],
    ['192.0.2.1', 4],
    ['192.168.1.1', 4],
    ['198.18.0.1', 4],
    ['198.51.100.1', 4],
    ['203.0.113.1', 4],
    ['224.0.0.1', 4],
    ['240.0.0.1', 4],
    ['255.255.255.255', 4],
    ['::', 6],
    ['::1', 6],
    ['::ffff:8.8.8.8', 6],
    ['64:ff9b::808:808', 6],
    ['64:ff9b:1::1', 6],
    ['100::1', 6],
    ['2001:2::1', 6],
    ['2001:db8::1', 6],
    ['2002:0808:0808::1', 6],
    ['3fff::1', 6],
    ['fc00::1', 6],
    ['fe80::1', 6],
    ['fec0::1', 6],
    ['ff02::1', 6],
  ] as const)('rejects non-global address %s', (address, family) => {
    expect(isGlobalRemoteAddress(address, family)).toBe(false);
    expect(() => vetRemoteAddresses([{ address, family }])).toThrowError(
      expect.objectContaining({ code: 'REMOTE_ADDRESS_DENIED' }),
    );
  });

  it.each([
    ['999.1.1.1', 4],
    ['01.2.3.4', 4],
    ['8.8.8.8', 6],
    ['2606:4700::1111', 4],
    ['fe80::1%eth0', 6],
    ['', 4],
  ] as const)('rejects malformed or wrong-family answer %s/%s', (address, family) => {
    expect(() => vetRemoteAddresses([{ address, family }])).toThrowError(
      expect.objectContaining({ code: 'REMOTE_DNS_ANSWER_INVALID' }),
    );
  });

  it('rejects empty, duplicate, mixed-private, and more than sixteen answers as a whole', () => {
    expect(() => vetRemoteAddresses([])).toThrowError(
      expect.objectContaining({ code: 'REMOTE_DNS_ANSWER_INVALID' }),
    );
    expect(() =>
      vetRemoteAddresses([
        { address: '8.8.8.8', family: 4 },
        { address: '8.8.8.8', family: 4 },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'REMOTE_DNS_ANSWER_INVALID' }));
    expect(() =>
      vetRemoteAddresses([
        { address: '2606:4700:4700::1111', family: 6 },
        { address: '2606:4700:4700:0:0:0:0:1111', family: 6 },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'REMOTE_DNS_ANSWER_INVALID' }));
    expect(() =>
      vetRemoteAddresses([
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'REMOTE_ADDRESS_DENIED' }));
    expect(() =>
      vetRemoteAddresses(
        Array.from({ length: REMOTE_IMAGE_LIMITS.maxDnsAnswers + 1 }, (_, index) => ({
          address: `8.8.8.${index + 1}`,
          family: 4 as const,
        })),
      ),
    ).toThrowError(expect.objectContaining({ code: 'REMOTE_DNS_ANSWER_LIMIT_EXCEEDED' }));
  });

  it.each([
    { allowedDomains: ['example.com'] },
    { allowedDomains: ['assets.example.com.'] },
    { allowedDomains: ['*.example.com'] },
    { allowedDomains: ['ASSETS.EXAMPLE.COM'] },
    { maxRedirects: 4 },
    { maxBytes: REMOTE_IMAGE_LIMITS.maxDecodedBytes + 1 },
    { allowedMimeTypes: ['image/svg+xml'] },
  ])('rejects invalid policy %o', overrides => {
    expect(() => validateRemoteImagePolicy(policy(overrides))).toThrowError(
      expect.objectContaining({ code: 'REMOTE_POLICY_INVALID' }),
    );
  });

  it('freezes a canonical exact-host policy without widening to subdomains', () => {
    const validated = validateRemoteImagePolicy(policy());
    expect(validated.allowedDomains).toEqual(['assets.example.com']);
    expect(Object.isFrozen(validated.allowedDomains)).toBe(true);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(validated.allowedDomains.includes('img.assets.example.com')).toBe(false);
  });
});
