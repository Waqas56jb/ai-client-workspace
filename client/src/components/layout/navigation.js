import {
  LayoutDashboard,
  Users,
  FolderKanban,
  ListChecks,
  Sparkles,
  Files,
  BadgeCheck,
  Search,
  Frame,
  SlidersHorizontal,
  Settings,
  UsersRound,
} from 'lucide-react';

export const NAV_SECTIONS = [
  {
    id: 'main',
    label: 'Workspace',
    items: [
      { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { to: '/clients', label: 'Clients', icon: Users },
      { to: '/jobs', label: 'Jobs & Projects', icon: FolderKanban },
      { to: '/tasks', label: 'Tasks', icon: ListChecks },
      { to: '/ai-workspace', label: 'AI Workspace', icon: Sparkles, highlight: true },
      { to: '/files', label: 'Files', icon: Files },
      { to: '/approved', label: 'Approved Work', icon: BadgeCheck },
      { to: '/search', label: 'Search', icon: Search },
    ],
  },
  {
    id: 'config',
    label: 'Configuration',
    items: [
      { to: '/image-presets', label: 'Image Presets', icon: Frame },
      { to: '/ai-instructions', label: 'AI Instructions', icon: SlidersHorizontal },
      { to: '/team', label: 'Team', icon: UsersRound },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];
