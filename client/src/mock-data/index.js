import { seedUsers } from './users';
import { seedClients } from './clients';
import { seedJobs } from './jobs';
import { seedTasks } from './tasks';
import { seedPresets } from './presets';
import { seedInstructions } from './instructions';
import { seedWorkspaceContent } from './workspace';

export { DEMO_PASSWORD } from './users';
export { EMPTY_BRAND } from './clients';
export { seedInstructions } from './instructions';

export const DEFAULT_PREFERENCES = {
  writingPreferences: 'Clear, concise and friendly. Avoid jargon.',
  spelling: 'Australian English',
  defaultTone: 'Professional',
  dateFormat: 'd MMM yyyy',
  defaultFileView: 'grid',
  defaultPresetId: 'pr_square',
  simulateFailures: false,
};

/** Builds a fresh, fully cross-linked demo workspace. */
export function buildSeed() {
  const users = seedUsers();
  const clients = seedClients();
  const jobs = seedJobs();
  const tasks = seedTasks();
  const presets = seedPresets();
  const instructions = seedInstructions();
  const content = seedWorkspaceContent({ clients, tasks });

  return {
    users,
    clients,
    jobs,
    tasks,
    presets,
    instructions,
    ...content,
    preferences: { ...DEFAULT_PREFERENCES },
    seededAt: new Date().toISOString(),
  };
}
