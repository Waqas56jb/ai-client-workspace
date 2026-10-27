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

/**
 * Pages behind the chat's "More" menu. The chat itself (/) is the home screen;
 * job and task pages are kept for detailed project work under "Projects".
 */
export const NAV_SECTIONS = [
  {
    id: 'main',
    label: 'Work',
    items: [
      { to: '/', label: 'Chat', icon: MessageSquareText, highlight: true, end: true },
      { to: '/history', label: 'Chat history', icon: History },
      { to: '/clients', label: 'Clients', icon: Users },
      { to: '/files', label: 'Files', icon: Files },
      { to: '/approved', label: 'Approved work', icon: BadgeCheck },
      { to: '/search', label: 'Search', icon: Search },
    ],
  },
  {
    id: 'config',
    label: 'Settings',
    items: [
      { to: '/image-presets', label: 'Image sizes', icon: Frame },
      { to: '/ai-instructions', label: 'AI instructions', icon: SlidersHorizontal },
      { to: '/team', label: 'Team', icon: UsersRound },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
  {
    id: 'projects',
    label: 'Projects',
    collapsed: true,
    items: [
      { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { to: '/jobs', label: 'Jobs & projects', icon: FolderKanban },
      { to: '/tasks', label: 'Tasks', icon: ListChecks },
      { to: '/ai-workspace', label: 'AI workspace (tasks)', icon: Sparkles },
    ],
  },
];
