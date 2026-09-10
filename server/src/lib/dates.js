// The ONLY place that decides what day it is.
//
// Day boundaries are a per-user question (app_user.timezone), so nothing else
// in the codebase may call current_date / CURRENT_DATE, or derive "today" from
// new Date(). Everything routes through here. If you are chasing a timezone
// bug, this file is the entire surface.

/** Today, as 'YYYY-MM-DD', in the given IANA timezone. */
export function todayIn(timezone) {
  // en-CA formats as YYYY-MM-DD, which is exactly Postgres's date input format.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Today for a given user row. */
export function todayFor(user) {
  return todayIn(user?.timezone || 'UTC');
}

/** Shift a 'YYYY-MM-DD' by N days, staying in plain-date space (no TZ math). */
export function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both 'YYYY-MM-DD'. Negative if `to` is earlier. */
export function daysBetween(from, to) {
  const ms = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

/** True if a valid IANA timezone name. Used to validate registration input. */
export function isValidTimezone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
