import type { Case, CaseEvent, Session } from "@rethread/contracts";
import { eventSchema } from "@rethread/contracts";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  csrf?: string,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.error?.code || "offline",
      body?.error?.message || "Connection interrupted. Try again.",
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const mutate = <T>(
  path: string,
  csrf: string,
  body: unknown = {},
  idempotency?: string,
) =>
  api<T>(
    path,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: idempotency ? { "Idempotency-Key": idempotency } : {},
    },
    csrf,
  );
export async function session() {
  return api<Session>("/session").catch((e) => {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  });
}
export function watchCase(
  id: string,
  initial: Case,
  onSnapshot: (value: Case) => void,
  onEvents: (value: CaseEvent[]) => void,
  onConnection: (value: boolean) => void,
) {
  const controller = new AbortController();
  let cursor = Number(initial.cursor),
    timer: ReturnType<typeof setTimeout>,
    delay = 1200;
  const seen = new Set<number>();
  async function poll() {
    try {
      const result = await api<{
        events: CaseEvent[];
        cursor: number;
        gap: boolean;
        hasMore: boolean;
      }>(`/cases/${id}/events?after=${cursor}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const incoming = result.events.map((e) => eventSchema.parse(e));
      if (result.gap) {
        const latest = await api<Case>(`/cases/${id}`, {
          signal: controller.signal,
        });
        cursor = Number(latest.cursor);
        onSnapshot(latest);
      } else {
        const unique = incoming.filter((e) => !seen.has(e.sequence));
        for (const e of unique) {
          seen.add(e.sequence);
          cursor = e.sequence;
        }
        if (unique.length) {
          onEvents(unique);
          const latest = await api<Case>(`/cases/${id}`, {
            signal: controller.signal,
          });
          if (!controller.signal.aborted) onSnapshot(latest);
        }
      }
      onConnection(true);
      delay = result.hasMore ? 50 : 1500;
    } catch (e) {
      if (controller.signal.aborted) return;
      onConnection(false);
      delay = Math.min(delay * 1.6, 15000);
    }
    if (!controller.signal.aborted) timer = setTimeout(poll, delay);
  }
  void poll();
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
