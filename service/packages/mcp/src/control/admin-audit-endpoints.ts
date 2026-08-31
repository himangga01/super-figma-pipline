import type { ActorContext } from '@sfp/shared';

import type { AdminAuditStore } from './admin-audit-store.js';

export const createAdminAuditEndpoint =
  (store: AdminAuditStore) =>
  async (
    principal: Readonly<ActorContext>,
    input: {
      kind?: string | undefined;
      since?: string | undefined;
      cursor?: string | undefined;
      limit?: string | number | undefined;
    },
  ) => {
    if (input.kind !== undefined && input.kind !== 'egress') {
      throw Object.assign(new Error('unsupported admin audit kind'), {
        code: 'ADMIN_AUDIT_QUERY_INVALID',
      });
    }
    const limit = input.limit === undefined ? 1000 : Number(input.limit);
    return store.queryEgress(principal.actorId, {
      since: input.since ?? null,
      cursor: input.cursor ?? null,
      limit,
    });
  };
