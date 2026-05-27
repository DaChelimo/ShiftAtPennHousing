import { describe, expect, it } from 'vitest';

import { CORE_VERSION } from '../src/index.js';

describe('core smoke', () => {
  it('arithmetic works', () => {
    expect(1 + 1).toBe(2);
  });

  it('exports CORE_VERSION', () => {
    expect(CORE_VERSION).toBe('0.0.0');
  });
});
