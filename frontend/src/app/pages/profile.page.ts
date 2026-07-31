import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService } from '../core/api.service';
import { SessionUser } from '../core/session.model';
import { SessionService } from '../core/session.service';

interface Profile extends SessionUser {
  id: number;
  is_active: boolean;
  created_at: string;
}

@Component({
  selector: 'app-profile-page',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (!profile) {
      <div class="card">
        @if (error) {
          <div class="error">{{ error }}</div>
        } @else {
          <p class="muted">Loading profile…</p>
        }
      </div>
    } @else {
      <div class="grid cols-2">
        <div class="card">
          <h2>Your account</h2>
          <div class="grid cols-2">
            <div>
              <div class="kpi-label">Email</div>
              <p>{{ profile.email }}</p>
            </div>
            <div>
              <div class="kpi-label">Role</div>
              <p><span class="badge">{{ profile.role }}</span></p>
            </div>
            <div>
              <div class="kpi-label">Iberia Plus</div>
              <p>{{ profile.iberia_plus_number ?? '—' }}</p>
            </div>
            <div>
              <div class="kpi-label">Status</div>
              <p>
                <span class="badge" [class.ok]="profile.is_active" [class.crit]="!profile.is_active">
                  {{ profile.is_active ? 'active' : 'inactive' }}
                </span>
              </p>
            </div>
          </div>
        </div>
        <div class="card">
          <h2>Edit profile</h2>
          @if (error) {
            <div class="error">{{ error }}</div>
          }
          @if (notice) {
            <div class="notice">{{ notice }}</div>
          }
          <form (ngSubmit)="onSubmit()">
            <div class="field">
              <label for="full_name">Full name</label>
              <input id="full_name" name="full_name" [(ngModel)]="fullName" required />
            </div>
            <div class="field">
              <label for="plus">Iberia Plus number</label>
              <input id="plus" name="plus" [(ngModel)]="plusNumber" placeholder="IB0000000" />
            </div>
            <button class="btn" type="submit" [disabled]="busy">
              {{ busy ? 'Saving…' : 'Save changes' }}
            </button>
          </form>
        </div>
      </div>
    }
  `,
})
export class ProfilePageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  profile: Profile | null = null;
  fullName = '';
  plusNumber = '';
  error: string | null = null;
  notice: string | null = null;
  busy = false;

  async ngOnInit(): Promise<void> {
    if (!this.session.getToken()) {
      await this.router.navigate(['/login']);
      return;
    }
    try {
      const me = await this.api.get<Profile>('/api/auth/me');
      this.profile = me;
      this.fullName = me.full_name;
      this.plusNumber = me.iberia_plus_number ?? '';
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load profile';
    }
  }

  async onSubmit(): Promise<void> {
    if (!this.profile) return;
    this.error = null;
    this.notice = null;
    this.busy = true;
    try {
      const updated = await this.api.patch<Profile>(`/api/users/${this.profile.id}`, {
        full_name: this.fullName,
        iberia_plus_number: this.plusNumber || null,
      });
      this.profile = updated;
      this.session.setSession(this.session.getToken() as string, updated);
      this.notice = 'Profile updated';
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Update failed';
    } finally {
      this.busy = false;
    }
  }
}
