import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  activityService,
  clientService,
  conversationService,
  dashboardService,
  fileService,
  instructionService,
  jobService,
  outputService,
  presetService,
  settingsService,
  taskService,
  userService,
  approvalService,
} from '@/services';

/**
 * React Query hooks over the service layer. Query keys start with the resource
 * name; after any mutation we invalidate everything, because mock data is
 * heavily cross-linked (counts, activity, search) and the demo dataset is small.
 */
export const qk = {
  clients: (p) => ['clients', p],
  client: (id) => ['client', id],
  jobs: (p) => ['jobs', p],
  job: (id) => ['job', id],
  tasks: (p) => ['tasks', p],
  task: (id) => ['task', id],
  users: () => ['users'],
  activity: (p) => ['activity', p],
  conversations: (taskId) => ['conversations', taskId],
  conversation: (id) => ['conversation', id],
  outputs: (p) => ['outputs', p],
  output: (id) => ['output', id],
  files: (p) => ['files', p],
  file: (id) => ['file', id],
  presets: (p) => ['presets', p],
  preset: (id) => ['preset', id],
  instructions: () => ['instructions'],
  approved: (p) => ['approved', p],
  dashboard: () => ['dashboard'],
  preferences: () => ['preferences'],
  storage: () => ['storage'],
};

const opt = (enabled) => ({ enabled: enabled !== false });

export const useClients = (params = {}, o) => useQuery({ queryKey: qk.clients(params), queryFn: () => clientService.list(params), ...o });
export const useClient = (id, o) => useQuery({ queryKey: qk.client(id), queryFn: () => clientService.get(id), ...opt(!!id), ...o });
export const useJobs = (params = {}, o) => useQuery({ queryKey: qk.jobs(params), queryFn: () => jobService.list(params), ...o });
export const useJob = (id, o) => useQuery({ queryKey: qk.job(id), queryFn: () => jobService.get(id), ...opt(!!id), ...o });
export const useTasks = (params = {}, o) => useQuery({ queryKey: qk.tasks(params), queryFn: () => taskService.list(params), ...o });
export const useTask = (id, o) => useQuery({ queryKey: qk.task(id), queryFn: () => taskService.get(id), ...opt(!!id), ...o });
export const useUsers = (o) => useQuery({ queryKey: qk.users(), queryFn: () => userService.list(), ...o });
export const useActivity = (params = {}, o) => useQuery({ queryKey: qk.activity(params), queryFn: () => activityService.list(params), ...o });
export const useConversations = (taskId, o) => useQuery({ queryKey: qk.conversations(taskId), queryFn: () => conversationService.listByTask(taskId), ...opt(!!taskId), ...o });
export const useChatHistory = (params = {}, o) =>
  useQuery({ queryKey: ['chat-history', params], queryFn: () => conversationService.history(params), placeholderData: (prev) => prev, ...o });
export const useConversation = (id, o) => useQuery({ queryKey: qk.conversation(id), queryFn: () => conversationService.get(id), ...opt(!!id), ...o });
export const useOutputs = (params = {}, o) => useQuery({ queryKey: qk.outputs(params), queryFn: () => outputService.list(params), ...o });
export const useOutput = (id, o) => useQuery({ queryKey: qk.output(id), queryFn: () => outputService.get(id), ...opt(!!id), ...o });
export const useFiles = (params = {}, o) => useQuery({ queryKey: qk.files(params), queryFn: () => fileService.list(params), ...o });
export const useFile = (id, o) => useQuery({ queryKey: qk.file(id), queryFn: () => fileService.get(id), ...opt(!!id), ...o });
export const usePresets = (params = {}, o) => useQuery({ queryKey: qk.presets(params), queryFn: () => presetService.list(params), ...o });
export const usePreset = (id, o) => useQuery({ queryKey: qk.preset(id), queryFn: () => presetService.get(id), ...opt(!!id), ...o });
export const useInstructions = (o) => useQuery({ queryKey: qk.instructions(), queryFn: () => instructionService.list(), ...o });
export const useApproved = (params = {}, o) => useQuery({ queryKey: qk.approved(params), queryFn: () => approvalService.listApproved(params), ...o });
export const useDashboard = (o) => useQuery({ queryKey: qk.dashboard(), queryFn: () => dashboardService.summary(), ...o });
export const usePreferences = (o) => useQuery({ queryKey: qk.preferences(), queryFn: () => settingsService.getPreferences(), ...o });
export const useStorageInfo = (o) => useQuery({ queryKey: qk.storage(), queryFn: () => settingsService.getStorageInfo(), ...o });

/**
 * Mutation wrapper: shows success / error toasts and refreshes all cached data.
 * @param {(vars) => Promise} fn
 * @param {{ success?: string | ((data, vars) => string), error?: string, onSuccess?: Function, silent?: boolean }} options
 */
export function useServiceMutation(fn, options = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (data, vars) => {
      await qc.invalidateQueries();
      const msg = typeof options.success === 'function' ? options.success(data, vars) : options.success;
      if (msg && !options.silent) toast.success(msg);
      options.onSuccess?.(data, vars);
    },
    onError: (err, vars) => {
      if (!options.silent) toast.error(options.error || err?.message || 'Something went wrong. Please try again.');
      options.onError?.(err, vars);
    },
  });
}
