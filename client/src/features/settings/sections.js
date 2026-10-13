import { isMockMode } from '@/lib/config';
import { HardDrive, LayoutGrid, ShieldCheck, SlidersHorizontal, UserRound } from 'lucide-react';

export const SETTINGS_SECTIONS = [
  { to: '/settings', end: true, label: 'Overview', icon: LayoutGrid },
  { to: '/settings/profile', label: 'Profile', icon: UserRound, description: 'Your name, email, avatar colour and display density.' },
  { to: '/settings/preferences', label: 'Preferences', icon: SlidersHorizontal, description: isMockMode ? 'Workspace writing defaults, date format, default views and AI simulation.' : 'Workspace writing defaults, date format and default views.' },
  { to: '/settings/storage', label: 'Storage', icon: HardDrive, description: isMockMode ? 'Demo storage used in this browser, record counts and workspace reset.' : 'Cloud storage used by the workspace and record counts.' },
  { to: '/settings/security', label: 'Security', icon: ShieldCheck, description: isMockMode ? 'Demo session details, production authentication and API-key handling.' : 'Your sign-in session, password and API-key handling.' },
];
