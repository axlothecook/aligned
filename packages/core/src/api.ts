// The typed API client — shared by web (and mobile later). One place that knows the
// backend's shape. Always sends the session cookie (`credentials: 'include'`).
//
// The base URL is injected per-platform (web reads NEXT_PUBLIC_API_URL).

export type ApiUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  username: string;
  discriminator: string;
  tag: string;
  displayName: string;
  bio: string | null;
  imageUrl: string | null;
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

export function createApiClient(baseUrl: string) {
  async function req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(res.status, (body as any)?.error ?? res.statusText, body);
    }
    return body as T;
  }

  return {
    // auth
    signup: (d: { email: string; username: string; displayName: string; password: string }) =>
      req<{ user: ApiUser }>('/auth/signup', { method: 'POST', body: JSON.stringify(d) }),
    login: (d: { email: string; password: string }) =>
      req<{ user: ApiUser }>('/auth/login', { method: 'POST', body: JSON.stringify(d) }),
    logout: () => req<{ ok: true }>('/auth/logout', { method: 'POST' }),
    me: () => req<{ user: ApiUser }>('/auth/me'),
    verifyEmail: (token: string) =>
      req<{ ok: true }>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),

    // profile
    updateProfile: (d: { displayName?: string; bio?: string | null; imageUrl?: string | null }) =>
      req<{ user: Partial<ApiUser> }>('/profile', { method: 'PATCH', body: JSON.stringify(d) }),
    lookupUser: (tag: string) =>
      req<{ user: any }>(`/users/${encodeURIComponent(tag)}`),

    // friends
    friendRequest: (tag: string) =>
      req<{ ok: true; status: string }>('/friends/request', { method: 'POST', body: JSON.stringify({ tag }) }),
    friendAccept: (tag: string) =>
      req<{ ok: true }>('/friends/accept', { method: 'POST', body: JSON.stringify({ tag }) }),
    friendDecline: (tag: string) =>
      req<{ ok: true }>('/friends/decline', { method: 'POST', body: JSON.stringify({ tag }) }),
    listFriends: () => req<{ friends: any[] }>('/friends'),
    listFriendRequests: () => req<{ requests: any[] }>('/friends/requests'),
    unfriend: (tag: string) => req<{ ok: true }>('/friends', { method: 'DELETE', body: JSON.stringify({ tag }) }),
    block: (tag: string) => req<{ ok: true }>('/blocks', { method: 'POST', body: JSON.stringify({ tag }) }),

    // shared calendars
    createCalendar: (d: { name?: string; startDate: string; memberTags?: string[] }) =>
      req<{ calendar: { id: string; name: string | null; startDate: string } }>('/shared-calendars', {
        method: 'POST',
        body: JSON.stringify(d),
      }),
    listCalendars: () => req<{ calendars: any[] }>('/shared-calendars'),
    getCalendar: (id: string) => req<{ calendar: any; members: any[] }>(`/shared-calendars/${id}`),
    addMember: (id: string, tag: string) =>
      req<{ ok: true }>(`/shared-calendars/${id}/members`, { method: 'POST', body: JSON.stringify({ tag }) }),
    updateMyMembership: (id: string, d: { color?: string; isReady?: boolean }) =>
      req<{ color: string; isReady: boolean }>(`/shared-calendars/${id}/me`, { method: 'PATCH', body: JSON.stringify(d) }),
    setSleep: (id: string, d: { startMinute: number; endMinute: number; timezone: string }) =>
      req<{ ok: true }>(`/shared-calendars/${id}/sleep`, { method: 'PUT', body: JSON.stringify(d) }),
    addRecurring: (id: string, d: { label: string; weekdays: number[]; startMinute: number; endMinute: number; timezone: string }) =>
      req<{ id: string }>(`/shared-calendars/${id}/recurring`, { method: 'POST', body: JSON.stringify(d) }),
    addEvent: (id: string, d: Record<string, unknown>) =>
      req<{ id: string }>(`/shared-calendars/${id}/events`, { method: 'POST', body: JSON.stringify(d) }),
    getFree: (id: string, from: string, to: string) =>
      req<{ allReady: boolean; free: { start: string; end: string }[] }>(
        `/shared-calendars/${id}/free?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
