// Postgres `daterange` customType for all-day events — a FLOATING date span with
// NO timezone (June 10 is June 10 everywhere). This is intentionally separate from
// `tstzrange`, which is an absolute UTC instant range used for TIMED events.
// (See the timezone research in DESIGN.md / ALIGNED_NOTES.md: all-day events must
// not be stored as UTC instants or they shift across zones.)
import { customType } from 'drizzle-orm/pg-core';

export const daterange = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'daterange';
  },
});
