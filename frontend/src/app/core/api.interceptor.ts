import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { ApiError } from './session.model';
import { SessionService } from './session.service';

function detailOf(error: HttpErrorResponse): string {
  const body: unknown = error.error;
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (detail !== undefined) return JSON.stringify(detail);
  }
  if (typeof body === 'string' && body) return body;
  return `${error.status} ${error.statusText}`;
}

/**
 * Injects the bearer token and JSON content type, and maps every non-2xx response to an
 * {@link ApiError} carrying the message, status and `x-request-id` correlation header.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionService);
  const token = session.getToken();
  const request = req.clone({
    setHeaders: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  return next(request).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        const requestId = error.headers?.get('x-request-id') ?? null;
        return throwError(() => new ApiError(detailOf(error), error.status, requestId));
      }
      return throwError(() => error);
    }),
  );
};
