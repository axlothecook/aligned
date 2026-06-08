// Drizzle has no built-in Postgres range type, so we define `tstzrange`
// (timezone-aware timestamp range) as a customType. This is the column the
// free-slot overlap query uses with the `&&` operator + a GiST index
// (DESIGN.md decisions #5–#7). Stored/compared in UTC.
//
// We treat the value as the raw Postgres range string on the TS side for now,
// e.g. '[2026-06-08 09:00+00,2026-06-08 10:00+00)'. A richer {start,end} mapping
// can be added later; the column type in Postgres is what matters for the schema.
import { customType } from 'drizzle-orm/pg-core';

export const tstzrange = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tstzrange';
  },
});
