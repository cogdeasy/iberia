import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Observable, map } from 'rxjs';

import { NAV_PAGES } from './app.routes';
import { LogoComponent } from './components/logo.component';
import { PageMeta, SECTION_LABELS, SECTION_ORDER, PageSection } from './core/pages.model';
import { SessionService } from './core/session.service';
import { SessionUser } from './core/session.model';

interface NavGroup {
  section: PageSection;
  label: string;
  items: PageMeta[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AsyncPipe, RouterLink, RouterLinkActive, RouterOutlet, LogoComponent],
  template: `
    <div class="shell">
      <header class="topbar">
        <a routerLink="/" class="brand" aria-label="Iberia home">
          <app-logo [height]="32" />
          <span class="brand-sub">Digital Platform</span>
        </a>
        <div class="session">
          @if (user$ | async; as user) {
            <span class="session-user"> {{ user.full_name }} · <em>{{ user.role }}</em> </span>
            <button class="btn ghost" type="button" (click)="signOut()">Sign out</button>
          } @else {
            <a routerLink="/login" class="btn light">Sign in</a>
          }
        </div>
      </header>
      <nav class="navbar">
        @for (group of navGroups$ | async; track group.section) {
          <div class="nav-group">
            <span class="nav-group-label">{{ group.label }}</span>
            @for (page of group.items; track page.path) {
              <a
                [routerLink]="page.path"
                routerLinkActive="active"
                [routerLinkActiveOptions]="{ exact: page.path === '/' }"
                class="nav-link"
              >
                {{ page.title }}
              </a>
            }
          </div>
        }
      </nav>
      <main class="content">
        <router-outlet />
      </main>
      <footer class="footer">
        Iberia Digital Platform · demo environment · not for production use
      </footer>
    </div>
  `,
})
export class AppComponent {
  private readonly session = inject(SessionService);

  readonly user$ = this.session.user$;

  readonly navGroups$: Observable<NavGroup[]> = this.user$.pipe(
    map((user) =>
      SECTION_ORDER.map((section) => ({
        section,
        label: SECTION_LABELS[section],
        items: NAV_PAGES.filter(
          (page) => page.section === section && page.title && this.visible(page.roles, user),
        ),
      })).filter((group) => group.items.length > 0),
    ),
  );

  signOut(): void {
    this.session.clearSession();
  }

  private visible(roles: string[] | undefined, user: SessionUser | null): boolean {
    return !roles?.length || (!!user && roles.includes(user.role));
  }
}
