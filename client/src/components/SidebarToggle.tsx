import { Icons } from '../icons';
import { useUIStore } from '../store';

/** Matches the drawer breakpoint in styles/_responsive.scss. */
export const DRAWER_QUERY = '(max-width: 820px)';

export const isDrawerViewport = (): boolean => window.matchMedia(DRAWER_QUERY).matches;

/**
 * Shown on narrow screens (opens the drawer) and on wide screens while the docked
 * sidebar is hidden (shows it again); hidden otherwise by CSS.
 */
export function SidebarToggle({ onMenu }: { readonly onMenu: () => void }) {
  const setHidden = useUIStore((s) => s.setSidebarHidden);
  return (
    <button
      className="icon-btn mobile-menu-btn"
      onClick={() => (isDrawerViewport() ? onMenu() : setHidden(false))}
      aria-label="開啟側邊欄"
      title="開啟側邊欄"
    >
      {Icons.menu}
    </button>
  );
}
