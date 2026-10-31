import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Small UI-only state for the chat workspace. Conversations, messages and files
 * live on the server (React Query); the AI's memory is the server's too.
 * Persisted: the last client (checked against the real client list before use),
 * the writing and picture-size preferences and the theme.
 */
export const useChatStore = create(
  persist(
    (set) => ({
      clientId: '',
      format: '',
      tone: '',
      presetId: '',
      theme: 'system', // 'system' | 'light' | 'dark'
      sidebarOpen: false, // mobile drawer (not persisted)

      setClientId: (clientId) => set({ clientId }),
      setWriting: (patch) => set(patch),
      setPresetId: (presetId) => set({ presetId }),
      setTheme: (theme) => set({ theme }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    }),
    {
      name: 'studioflow.chat',
      partialize: ({ clientId, format, tone, presetId, theme }) => ({ clientId, format, tone, presetId, theme }),
    },
  ),
);
