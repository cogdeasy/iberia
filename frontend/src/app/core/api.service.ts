import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom, map } from 'rxjs';

/** Thin `HttpClient` wrapper mirroring the former `api<T>()` fetch helper. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  /** `x-request-id` of the most recent successful response, for support/debug surfaces. */
  readonly lastRequestId = signal<string | null>(null);

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('DELETE', path, body);
  }

  request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = path.startsWith('/') ? path : `/${path}`;
    return firstValueFrom(
      this.http
        .request<T>(method, url, { body, observe: 'response' })
        .pipe(
          map((response) => {
            this.lastRequestId.set(response.headers.get('x-request-id'));
            return response.body as T;
          }),
        ),
    );
  }
}
