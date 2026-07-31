import { Routes } from '@angular/router';

import { PageMeta, sortPages } from './core/pages.model';
import { roleGuard } from './core/role.guard';

/**
 * Angular has no `import.meta.glob`, so pages are registered explicitly here instead of being
 * discovered from the filesystem. Adding a page means adding one entry to `PAGES` (nav metadata)
 * and one lazy route below, keeping the two in sync via the shared `path`.
 */
export const PAGES: PageMeta[] = [
  { path: '/', title: 'Home', section: 'customer', order: 0 },
  { path: '/login', title: 'Sign in', section: 'customer', order: 1 },
  { path: '/profile', title: 'Profile', section: 'customer', order: 2 },
  { path: '/flights', title: 'Flights', section: 'customer', order: 10 },
  { path: '/book/:flightId', section: 'customer', order: 21 },
  { path: '/bookings', title: 'My bookings', section: 'customer', order: 22 },
  { path: '/checkin', title: 'Check-in', section: 'customer', order: 30 },
  { path: '/checkout/:pnr', section: 'customer', order: 41 },
  { path: '/loyalty', title: 'Iberia Plus', section: 'customer', order: 40 },
  { path: '/payments', title: 'Payments', section: 'customer', order: 40 },
  { path: '/support', title: 'Support', section: 'customer', order: 60 },
  {
    path: '/ops/reliability',
    title: 'Reliability',
    section: 'ops',
    order: 10,
    roles: ['ops', 'sre', 'admin'],
  },
  { path: '/ops/slos', title: 'SLOs', section: 'ops', order: 11, roles: ['ops', 'sre', 'admin'] },
  {
    path: '/ops/chaos',
    title: 'Chaos & load',
    section: 'ops',
    order: 12,
    roles: ['ops', 'sre', 'admin'],
  },
  {
    path: '/ops/irrops',
    title: 'Irregular ops',
    section: 'ops',
    order: 20,
    roles: ['ops', 'admin', 'sre', 'agent'],
  },
  {
    path: '/ops/alerts',
    title: 'Alerts',
    section: 'ops',
    order: 29,
    roles: ['ops', 'sre', 'admin'],
  },
  {
    path: '/ops/incidents',
    title: 'Incidents',
    section: 'ops',
    order: 30,
    roles: ['ops', 'sre', 'admin'],
  },
  // No `title`: reached from the incident board, so it stays out of the nav.
  { path: '/ops/incidents/:id', section: 'ops', order: 31, roles: ['ops', 'sre', 'admin'] },
  {
    path: '/ops/notifications',
    title: 'Notifications',
    section: 'ops',
    order: 40,
    roles: ['ops', 'sre', 'admin', 'agent'],
  },
  {
    path: '/security',
    title: 'Security posture',
    section: 'security',
    order: 10,
    roles: ['admin', 'sre'],
  },
  {
    path: '/security/audit',
    title: 'Audit trail',
    section: 'security',
    order: 11,
    roles: ['admin', 'sre'],
  },
];

/** Nav entries in the order the React app rendered them. */
export const NAV_PAGES: PageMeta[] = sortPages(PAGES);

function rolesOf(path: string): string[] {
  const page = PAGES.find((entry) => entry.path === path);
  if (!page) throw new Error(`No PAGES entry for route ${path}`);
  return page.roles ?? [];
}

function guarded(path: string) {
  const roles = rolesOf(path);
  return roles.length ? { canActivate: [roleGuard], data: { roles } } : {};
}

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./pages/home.page').then((m) => m.HomePageComponent),
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login.page').then((m) => m.LoginPageComponent),
  },
  {
    path: 'profile',
    loadComponent: () => import('./pages/profile.page').then((m) => m.ProfilePageComponent),
  },
  {
    path: 'flights',
    loadComponent: () => import('./pages/flights.page').then((m) => m.FlightsPageComponent),
  },
  {
    path: 'book/:flightId',
    loadComponent: () => import('./pages/book.page').then((m) => m.BookPageComponent),
  },
  {
    path: 'bookings',
    loadComponent: () => import('./pages/bookings.page').then((m) => m.BookingsPageComponent),
  },
  {
    path: 'checkin',
    loadComponent: () => import('./pages/checkin.page').then((m) => m.CheckinPageComponent),
  },
  {
    path: 'checkout/:pnr',
    loadComponent: () => import('./pages/checkout.page').then((m) => m.CheckoutPageComponent),
  },
  {
    path: 'loyalty',
    loadComponent: () => import('./pages/loyalty.page').then((m) => m.LoyaltyPageComponent),
  },
  {
    path: 'payments',
    loadComponent: () => import('./pages/payments.page').then((m) => m.PaymentsPageComponent),
  },
  {
    path: 'support',
    loadComponent: () => import('./pages/support.page').then((m) => m.SupportPageComponent),
  },
  {
    path: 'ops/reliability',
    loadComponent: () => import('./pages/sre-overview.page').then((m) => m.SreOverviewPageComponent),
    ...guarded('/ops/reliability'),
  },
  {
    path: 'ops/slos',
    loadComponent: () => import('./pages/sre-slos.page').then((m) => m.SreSlosPageComponent),
    ...guarded('/ops/slos'),
  },
  {
    path: 'ops/chaos',
    loadComponent: () => import('./pages/sre-chaos.page').then((m) => m.SreChaosPageComponent),
    ...guarded('/ops/chaos'),
  },
  {
    path: 'ops/irrops',
    loadComponent: () => import('./pages/irrops.page').then((m) => m.IrropsPageComponent),
    ...guarded('/ops/irrops'),
  },
  {
    path: 'ops/alerts',
    loadComponent: () => import('./pages/alerts.page').then((m) => m.AlertsPageComponent),
    ...guarded('/ops/alerts'),
  },
  {
    path: 'ops/incidents',
    pathMatch: 'full',
    loadComponent: () => import('./pages/incidents.page').then((m) => m.IncidentsPageComponent),
    ...guarded('/ops/incidents'),
  },
  {
    path: 'ops/incidents/:id',
    loadComponent: () =>
      import('./pages/incident-detail.page').then((m) => m.IncidentDetailPageComponent),
    ...guarded('/ops/incidents/:id'),
  },
  {
    path: 'ops/notifications',
    loadComponent: () =>
      import('./pages/notifications.page').then((m) => m.NotificationsPageComponent),
    ...guarded('/ops/notifications'),
  },
  {
    path: 'security',
    pathMatch: 'full',
    loadComponent: () =>
      import('./pages/security-posture.page').then((m) => m.SecurityPosturePageComponent),
    ...guarded('/security'),
  },
  {
    path: 'security/audit',
    loadComponent: () =>
      import('./pages/security-audit.page').then((m) => m.SecurityAuditPageComponent),
    ...guarded('/security/audit'),
  },
  { path: '**', redirectTo: '' },
];
