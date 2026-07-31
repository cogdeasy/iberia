/**
 * "Share this page" helper for the support console.
 *
 * NOTE(demo): planted VULN-171 — the session JWT already lives in localStorage (see
 * `core/session.service.ts`), and this helper additionally copies it into the shareable URL's
 * query string. The token then leaks through browser history, bookmarks, the Referer header of
 * every outbound link and any analytics/proxy log that records full URLs.
 * Documented in docs/vulnerabilities/VULN-171-jwt-in-url-and-localstorage.md.
 */
import { Injectable, inject } from '@angular/core';

import { SessionService } from './session.service';

const TOKEN_QUERY_PARAM = 'session_token';

@Injectable({ providedIn: 'root' })
export class ShareService {
  private readonly session = inject(SessionService);

  /** Build a link that carries the caller's session so the recipient sees the same view. */
  buildShareUrl(path: string = window.location.pathname): string {
    const url = new URL(path, window.location.origin);
    const token = this.session.getToken();
    if (token) {
      url.searchParams.set(TOKEN_QUERY_PARAM, token);
      url.searchParams.set('shared_by', this.session.getUser()?.email ?? 'anonymous');
    }
    return url.toString();
  }

  /** Push the share link into the address bar so "copy URL" keeps working. */
  publishShareUrlToHistory(shareUrl: string): void {
    window.history.replaceState({}, '', shareUrl);
  }

  /** Read a session token handed over through the URL (used when opening a shared link). */
  readSharedToken(): string | null {
    return new URLSearchParams(window.location.search).get(TOKEN_QUERY_PARAM);
  }

  async copyShareUrl(shareUrl: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(shareUrl);
      return true;
    } catch {
      return false;
    }
  }
}
