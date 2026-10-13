import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** UI-only state. View preferences persist per browser; nothing here is workspace data. */
export const useUiStore = create(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      commandOpen: false,
      breadcrumbs: [],
      views: {},
      workspacePanels: { left: true, right: true },

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileNav: (open) => set({ mobileNavOpen: open }),
      setCommandOpen: (open) => set({ commandOpen: open }),
      setBreadcrumbs: (breadcrumbs) => set({ breadcrumbs }),
      setView: (key, value) => set((s) => ({ views: { ...s.views, [key]: value } })),
      setWorkspacePanel: (side, open) => set((s) => ({ workspacePanels: { ...s.workspacePanels, [side]: open } })),
    }),
    {
      name: 'studioflow.ui',
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, views: s.views, workspacePanels: s.workspacePanels }),
    },
  ),
);
