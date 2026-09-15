// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';

import { consumePairBootstrap } from '../../ui/relay/bootstrap.js';

afterEach(() => {
  document.body.innerHTML = '';
});
describe('one-use local bootstrap', () => {
  it('consumes and scrubs the seed before returning it', () => {
    const element = document.createElement('script');
    element.id = 'sfp-pair-bootstrap';
    element.textContent = JSON.stringify({ pairCode: 'SFP-ABCDEFGHIJ-12345678' });
    document.body.append(element);
    expect(consumePairBootstrap(document)).toBe('SFP-ABCDEFGHIJ-12345678');
    expect(element.textContent).toBe('');
    expect(element.isConnected).toBe(false);
    expect(consumePairBootstrap(document)).toBeNull();
  });
  it.each([
    'invalid',
    JSON.stringify({ pairCode: 'bad' }),
    JSON.stringify({ pairCode: 'SFP-ABCDEFGHIJ-12345678', controlToken: 'forbidden' }),
  ])('rejects and removes malformed seeds', text => {
    const element = document.createElement('script');
    element.id = 'sfp-pair-bootstrap';
    element.textContent = text;
    document.body.append(element);
    expect(consumePairBootstrap(document)).toBeNull();
    expect(element.textContent).toBe('');
    expect(element.isConnected).toBe(false);
  });
});
