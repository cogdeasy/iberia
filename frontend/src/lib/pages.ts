import type { ComponentType } from 'react'

export type PageSection = 'customer' | 'ops' | 'security'

export interface PageMeta {
  /** Route path, e.g. '/flights' or '/ops/incidents'. */
  path: string
  /** Label shown in the navigation bar. Omit to hide from navigation. */
  title?: string
  section: PageSection
  /** Titled customer pages join the main navigation unless this is `'none'`. */
  nav?: 'primary' | 'none'
  /** Lower numbers appear first in the nav. */
  order?: number
  /** Roles allowed to see the nav entry (empty/undefined = everyone). */
  roles?: string[]
}

export interface DiscoveredPage extends PageMeta {
  Component: ComponentType
}

type PageModule = { default: ComponentType; meta: PageMeta }

/**
 * Pages are auto-discovered: drop `src/pages/<name>.page.tsx` exporting a default
 * component and a `meta: PageMeta`. No shared router file has to be edited, which keeps
 * parallel frontend workstreams conflict-free.
 */
export function discoverPages(): DiscoveredPage[] {
  const modules = import.meta.glob<PageModule>('../pages/**/*.page.tsx', { eager: true })
  return Object.values(modules)
    .filter((mod) => mod?.meta?.path)
    .map((mod) => ({ ...mod.meta, Component: mod.default }))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.path.localeCompare(b.path))
}

export const SECTION_LABELS: Record<PageSection, string> = {
  customer: 'Travel',
  ops: 'Operations & SRE',
  security: 'Security',
}
