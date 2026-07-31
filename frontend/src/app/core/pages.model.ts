export type PageSection = 'customer' | 'ops' | 'security';

export interface PageMeta {
  /** Route path, e.g. '/flights' or '/ops/incidents'. */
  path: string;
  /** Label shown in the navigation bar. Omit to hide from navigation. */
  title?: string;
  section: PageSection;
  /** Lower numbers appear first in the nav. */
  order?: number;
  /** Roles allowed to see the nav entry / open the page (empty/undefined = everyone). */
  roles?: string[];
}

export const SECTION_ORDER: PageSection[] = ['customer', 'ops', 'security'];

export const SECTION_LABELS: Record<PageSection, string> = {
  customer: 'Travel',
  ops: 'Operations & SRE',
  security: 'Security',
};

/** Same ordering the React `discoverPages()` helper applied: by `order`, then by path. */
export function sortPages(pages: PageMeta[]): PageMeta[] {
  return [...pages].sort(
    (a, b) => (a.order ?? 100) - (b.order ?? 100) || a.path.localeCompare(b.path),
  );
}
