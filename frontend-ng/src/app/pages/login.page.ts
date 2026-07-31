import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService } from '../core/api.service';
import { SessionUser } from '../core/session.model';
import { SessionService } from '../core/session.service';

interface LoginResponse {
  access_token: string;
  token_type: string;
  user: SessionUser;
}

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="grid cols-2">
      <section class="hero">
        <h1>Welcome to Iberia</h1>
        <p>Sign in to manage bookings, check in and track your Iberia Plus Avios.</p>
      </section>
      <div class="card">
        <h2>Sign in</h2>
        @if (error) {
          <div class="error">{{ error }}</div>
        }
        <form (ngSubmit)="onSubmit()">
          <div class="field">
            <label for="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              [(ngModel)]="email"
              autocomplete="username"
              required
            />
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              [(ngModel)]="password"
              autocomplete="current-password"
              required
            />
          </div>
          <button class="btn" type="submit" [disabled]="busy">
            {{ busy ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>
        <p class="muted" style="margin-top: 16px">
          Demo accounts use password <code>Iberia2026!</code>
        </p>
      </div>
    </div>
  `,
})
export class LoginPageComponent {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  email = 'customer@iberia.demo';
  password = '';
  error: string | null = null;
  busy = false;

  async onSubmit(): Promise<void> {
    this.error = null;
    this.busy = true;
    try {
      const result = await this.api.post<LoginResponse>('/api/auth/login', {
        email: this.email,
        password: this.password,
      });
      this.session.setSession(result.access_token, result.user);
      await this.router.navigate(['/']);
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Sign in failed';
    } finally {
      this.busy = false;
    }
  }
}
