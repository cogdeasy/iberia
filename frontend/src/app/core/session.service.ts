import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

import { SessionUser } from './session.model';

const TOKEN_KEY = 'iberia.token';
const USER_KEY = 'iberia.user';

/** Session storage + the observable current user (replaces the `iberia:session` DOM event). */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly userSubject = new BehaviorSubject<SessionUser | null>(this.readUser());

  readonly user$: Observable<SessionUser | null> = this.userSubject.asObservable();

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  getUser(): SessionUser | null {
    return this.userSubject.value;
  }

  setSession(token: string, user: SessionUser): void {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this.userSubject.next(user);
  }

  clearSession(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.userSubject.next(null);
  }

  private readUser(): SessionUser | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionUser;
    } catch {
      return null;
    }
  }
}
