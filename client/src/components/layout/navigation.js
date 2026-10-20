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
  MessageSquareText,
  History,
} from 'lucide-react';

export const NAV_SECTIONS = [
  {
    id: 'main',
    label: 'Workspace',
    items: [
      { to: '/assistant', label: 'AI Assistant', icon: MessageSquareText, highlight: true },
      { to: '/history', label: 'Chat History', icon: History },
      { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { to: '/clients', label: 'Clients', icon: Users },
      { to: '/jobs', label: 'Jobs & Projects', icon: FolderKanban },
      { to: '/tasks', label: 'Tasks', icon: ListChecks },
      { to: '/ai-workspace', label: 'AI Workspace (tasks)', icon: Sparkles },
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
