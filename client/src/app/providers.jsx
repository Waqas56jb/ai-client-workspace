import { useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { subscribeDb } from '@/services/mock/db';
import { isMockMode } from '@/lib/config';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => err?.status !== 404 && count < 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Another browser tab changed the shared demo workspace → refresh cached data. */
function CrossTabSync() {
  const qc = useQueryClient();
  useEffect(() => subscribeDb(() => qc.invalidateQueries()), [qc]);
  return null;
}

export function Providers({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      {isMockMode && <CrossTabSync />}
      {children}
      <Toaster
        position="top-center"
        richColors
        closeButton
        toastOptions={{ style: { fontFamily: 'Inter, sans-serif', fontSize: '13px', borderRadius: '12px' } }}
      />
    </QueryClientProvider>
  );
}
