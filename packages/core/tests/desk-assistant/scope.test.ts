// Desk Assistant Phase A — scope predicate truth table (V1_SCOPE §6.3, §10.5).
//
// This is the shared truth table the SQL `da_can_read_item` placeholder matrix
// mirrors (supabase/migrations/20260710000001_desk_assistant_foundations.sql).
// When the real scoping matrix lands, update both this table and the SQL together.

import { describe, expect, it } from 'vitest';

import {
  assertEmbeddingDimension,
  canReadItem,
  EMBEDDING_DIM,
  filterReadable,
  type DeskRole,
  type ItemScope,
  type RequesterContext,
  type Sensitivity,
} from '../../src/desk-assistant/index.js';

function requester(overrides: Partial<RequesterContext> = {}): RequesterContext {
  return {
    userId: 'u-1',
    homeHouseId: 'harnwell',
    roles: ['sw'],
    isActive: true,
    isAdmin: false,
    isRsm: false,
    houseAdminOf: [],
    ...overrides,
  };
}

function scope(overrides: Partial<ItemScope> = {}): ItemScope {
  return {
    houseScope: null,
    sensitivity: 'general' as Sensitivity,
    allowedRoles: [] as DeskRole[],
    ...overrides,
  };
}

describe('house gate', () => {
  it('shared corpus (null) is readable by any worker', () => {
    expect(canReadItem(requester({ homeHouseId: 'quad' }), scope())).toBe(true);
  });

  it('an overlay is readable by the home-house worker', () => {
    expect(
      canReadItem(requester({ homeHouseId: 'harnwell' }), scope({ houseScope: 'harnwell' })),
    ).toBe(true);
  });

  it('an overlay is NOT readable by a worker from another house', () => {
    expect(canReadItem(requester({ homeHouseId: 'quad' }), scope({ houseScope: 'harnwell' }))).toBe(
      false,
    );
  });

  it('an overlay is readable by that house HM/BM (house-admin)', () => {
    expect(
      canReadItem(
        requester({ homeHouseId: 'quad', roles: ['hm'], houseAdminOf: ['harnwell'] }),
        scope({ houseScope: 'harnwell' }),
      ),
    ).toBe(true);
  });

  it('an overlay is NOT readable by an HM of a different house', () => {
    expect(
      canReadItem(
        requester({ homeHouseId: 'quad', roles: ['hm'], houseAdminOf: ['quad'] }),
        scope({ houseScope: 'harnwell' }),
      ),
    ).toBe(false);
  });

  it('an RSM can read any house overlay (cross-house read)', () => {
    expect(
      canReadItem(
        requester({ homeHouseId: 'quad', roles: ['rsm'], isRsm: true }),
        scope({ houseScope: 'harnwell' }),
      ),
    ).toBe(true);
  });

  it('admin can read any house overlay', () => {
    expect(
      canReadItem(
        requester({ homeHouseId: 'quad', roles: ['admin'], isAdmin: true }),
        scope({ houseScope: 'harnwell' }),
      ),
    ).toBe(true);
  });
});

describe('sensitivity gate', () => {
  it('general is readable by all', () => {
    expect(canReadItem(requester(), scope({ sensitivity: 'general' }))).toBe(true);
  });

  it('internal is readable by an active user', () => {
    expect(canReadItem(requester({ isActive: true }), scope({ sensitivity: 'internal' }))).toBe(
      true,
    );
  });

  it('internal is NOT readable by an inactive user', () => {
    expect(canReadItem(requester({ isActive: false }), scope({ sensitivity: 'internal' }))).toBe(
      false,
    );
  });

  it('restricted is NOT readable by a plain SW', () => {
    expect(canReadItem(requester({ roles: ['sw'] }), scope({ sensitivity: 'restricted' }))).toBe(
      false,
    );
  });

  it('restricted is readable by HM and BM', () => {
    expect(canReadItem(requester({ roles: ['hm'] }), scope({ sensitivity: 'restricted' }))).toBe(
      true,
    );
    expect(canReadItem(requester({ roles: ['bm'] }), scope({ sensitivity: 'restricted' }))).toBe(
      true,
    );
  });

  it('restricted is readable by admin', () => {
    expect(canReadItem(requester({ isAdmin: true }), scope({ sensitivity: 'restricted' }))).toBe(
      true,
    );
  });

  it('restricted is NOT readable by an SM (not house-admin tier)', () => {
    expect(canReadItem(requester({ roles: ['sm'] }), scope({ sensitivity: 'restricted' }))).toBe(
      false,
    );
  });
});

describe('role gate', () => {
  it('empty allowedRoles is readable by every role', () => {
    expect(canReadItem(requester({ roles: ['sw'] }), scope({ allowedRoles: [] }))).toBe(true);
  });

  it('a role-scoped item is readable by a user who holds the role', () => {
    expect(canReadItem(requester({ roles: ['sm'] }), scope({ allowedRoles: ['sm'] }))).toBe(true);
  });

  it('a role-scoped item is NOT readable by a user lacking the role', () => {
    expect(canReadItem(requester({ roles: ['sw'] }), scope({ allowedRoles: ['sm', 'hm'] }))).toBe(
      false,
    );
  });
});

describe('combined gates', () => {
  it('all three gates must pass (overlay + restricted + role)', () => {
    const strict = scope({
      houseScope: 'harnwell',
      sensitivity: 'restricted',
      allowedRoles: ['hm'],
    });
    // Harnwell HM: home house matches, HM clears restricted + role → readable.
    expect(
      canReadItem(
        requester({ homeHouseId: 'harnwell', roles: ['hm'], houseAdminOf: ['harnwell'] }),
        strict,
      ),
    ).toBe(true);
    // Harnwell SW: house ok, but fails restricted + role gate.
    expect(canReadItem(requester({ homeHouseId: 'harnwell', roles: ['sw'] }), strict)).toBe(false);
  });

  it('filterReadable keeps only readable items', () => {
    const sw = requester({ homeHouseId: 'quad', roles: ['sw'] });
    const items = [
      { id: 'shared', scope: scope() },
      { id: 'quad-overlay', scope: scope({ houseScope: 'quad' }) },
      { id: 'harnwell-overlay', scope: scope({ houseScope: 'harnwell' }) },
      { id: 'restricted', scope: scope({ sensitivity: 'restricted' }) },
    ];
    expect(filterReadable(sw, items).map((i) => i.id)).toEqual(['shared', 'quad-overlay']);
  });
});

describe('embeddings guard', () => {
  it('EMBEDDING_DIM is 1024 (voyage-3)', () => {
    expect(EMBEDDING_DIM).toBe(1024);
  });

  it('assertEmbeddingDimension passes at the right length', () => {
    expect(() => assertEmbeddingDimension(new Array(1024).fill(0))).not.toThrow();
  });

  it('assertEmbeddingDimension throws on a mismatch', () => {
    expect(() => assertEmbeddingDimension([0, 1, 2])).toThrow(/dimension mismatch/);
  });
});
