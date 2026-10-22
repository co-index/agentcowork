import type {
  BoardSectionView,
  ListResult,
  MemberView,
  MessageView,
  RoomSummaryView,
} from '@agentcowork/shared';
import { SseParser } from './sse';

const TOKEN_KEY = 'agentcowork.token';

/** Reads `#token=…` once (then strips it from the URL), falling back to localStorage. */
export function loadToken(): string | null {
  const match = /(?:^|[#&])token=([^&]+)/.exec(window.location.hash);
  if (match) {
    const token = decodeURIComponent(match[1]!);
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Private mode: keep it for this page load only.
    }
    history.replaceState(
      null,
      '',
      `${window.location.pathname}${stripToken(window.location.hash)}`,
    );
    // replaceState does not fire hashchange; let the router see the cleaned-up route.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return token;
  }
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Removes the token parameter from a location hash: "#token=x&/rooms/A" -> "#/rooms/A". */
export function stripToken(hash: string): string {
  const rest = hash
    .replace(/^#/, '')
    .split('&')
    .filter((part) => part && !part.startsWith('token='))
    .join('&');
  return rest ? `#${rest}` : '';
}

export function saveToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface RoomDetail {
  room: RoomSummaryView;
  stages: string[];
  pause_reason: string | null;
  members: (MemberView & { ready: boolean })[];
  board: Record<string, BoardSectionView>;
}

export class Api {
  constructor(
    private readonly token: string,
    /** Called on HTTP 401, e.g. after a host restart issued a new token. */
    private readonly onUnauthorized: () => void = () => undefined,
  ) {}

  rooms() {
    return this.get<{ rooms: RoomSummaryView[] }>('/api/rooms');
  }

  room(slug: string) {
    return this.get<RoomDetail>(`/api/rooms/${encodeURIComponent(slug)}`);
  }

  messages(slug: string, params: { after_seq?: number; before_seq?: number; limit?: number }) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
    return this.get<ListResult>(`/api/rooms/${encodeURIComponent(slug)}/messages?${q}`);
  }

  post(slug: string, body: { name: string; content: string; kind: string; mentions?: string[] }) {
    return this.request<{ seq: number; redacted?: string[] }>(
      `/api/rooms/${encodeURIComponent(slug)}/messages`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  }

  boardHistory(slug: string, key: string) {
    return this.get<{ versions: BoardSectionView[] }>(
      `/api/rooms/${encodeURIComponent(slug)}/board/${encodeURIComponent(key)}/history`,
    );
  }

  /** Subscribes to room events; reconnects with backoff until the signal aborts. */
  async subscribe(
    slug: string,
    handlers: { onMessage: (m: MessageView) => void; onMembers: () => void; onOpen: () => void },
    signal: AbortSignal,
  ) {
    let delay = 1000;
    while (!signal.aborted) {
      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(slug)}/events`, {
          headers: { authorization: `Bearer ${this.token}` },
          signal,
        });
        if (res.status === 401) return this.onUnauthorized();
        if (!res.ok || !res.body) throw new Error(`events: HTTP ${res.status}`);
        delay = 1000;
        const parser = new SseParser();
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const ev of parser.push(value)) {
            if (ev.event === 'ready') handlers.onOpen();
            else if (ev.event === 'message') handlers.onMessage(JSON.parse(ev.data) as MessageView);
            else if (ev.event === 'members') handlers.onMembers();
          }
        }
      } catch {
        if (signal.aborted) return;
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 15_000);
    }
  }

  private get<T>(path: string) {
    return this.request<T>(path, { method: 'GET' });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(path, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    if (res.status === 401) this.onUnauthorized();
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok)
      throw new ApiError(res.status, body.error ?? 'HTTP', body.message ?? res.statusText);
    return body as T;
  }
}
