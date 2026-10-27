import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, useParams, useRouteError } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AppShell } from '@/components/layout';
import { RequireAuth, RedirectIfAuthed } from './RequireAuth';
import { ErrorState, Page } from '@/components/ui';

const LoginPage = lazy(() => import('@/features/auth/LoginPage'));
const ForgotPasswordPage = lazy(() => import('@/features/auth/ForgotPasswordPage'));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const ChatPage = lazy(() => import('@/features/chat/ChatPage'));
const ChatHistoryPage = lazy(() => import('@/features/history/ChatHistoryPage'));
const ClientsPage = lazy(() => import('@/features/clients/ClientsPage'));
const ClientFormPage = lazy(() => import('@/features/clients/ClientFormPage'));
const ClientDetailPage = lazy(() => import('@/features/clients/ClientDetailPage'));
const JobsPage = lazy(() => import('@/features/jobs/JobsPage'));
const JobFormPage = lazy(() => import('@/features/jobs/JobFormPage'));
const JobDetailPage = lazy(() => import('@/features/jobs/JobDetailPage'));
const TasksPage = lazy(() => import('@/features/tasks/TasksPage'));
const TaskFormPage = lazy(() => import('@/features/tasks/TaskFormPage'));
const TaskDetailPage = lazy(() => import('@/features/tasks/TaskDetailPage'));
const AiWorkspaceHome = lazy(() => import('@/features/ai-workspace/AiWorkspaceHome'));
const AiWorkspacePage = lazy(() => import('@/features/ai-workspace/AiWorkspacePage'));
const FilesPage = lazy(() => import('@/features/files/FilesPage'));
const FileDetailPage = lazy(() => import('@/features/files/FileDetailPage'));
const ApprovedWorkPage = lazy(() => import('@/features/approved-work/ApprovedWorkPage'));
const SearchPage = lazy(() => import('@/features/search/SearchPage'));
const PresetsPage = lazy(() => import('@/features/image-presets/PresetsPage'));
const PresetEditorPage = lazy(() => import('@/features/image-presets/PresetEditorPage'));
const AiInstructionsPage = lazy(() => import('@/features/ai-instructions/AiInstructionsPage'));
const TeamPage = lazy(() => import('@/features/team/TeamPage'));
const SettingsLayout = lazy(() => import('@/features/settings/SettingsLayout'));
const SettingsOverviewPage = lazy(() => import('@/features/settings/SettingsOverviewPage'));
const ProfileSettingsPage = lazy(() => import('@/features/settings/ProfileSettingsPage'));
const PreferencesSettingsPage = lazy(() => import('@/features/settings/PreferencesSettingsPage'));
const StorageSettingsPage = lazy(() => import('@/features/settings/StorageSettingsPage'));
const SecuritySettingsPage = lazy(() => import('@/features/settings/SecuritySettingsPage'));
const NotFoundPage = lazy(() => import('@/features/misc/NotFoundPage'));

function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading page">
      <Loader2 className="animate-spin text-brand" size={22} />
    </div>
  );
}

const s = (el) => <Suspense fallback={<PageLoader />}>{el}</Suspense>;

/** Old AI Assistant links keep working. */
function LegacyChatRedirect() {
  const { conversationId } = useParams();
  return <Navigate to={`/chat/${conversationId}`} replace />;
}

function RouteError() {
  const error = useRouteError();
  return (
    <Page narrow>
      <ErrorState title="This page failed to load" error={{ message: error?.message || 'An unexpected error occurred.' }} onRetry={() => window.location.reload()} />
    </Page>
  );
}

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      {
        element: <RedirectIfAuthed />,
        children: [
          { path: '/login', element: s(<LoginPage />) },
          { path: '/forgot-password', element: s(<ForgotPasswordPage />) },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          // The chat is the home screen and has its own simple layout.
          { path: '/', element: s(<ChatPage />), errorElement: <RouteError /> },
          { path: '/chat/:conversationId', element: s(<ChatPage />), errorElement: <RouteError /> },
          { path: '/assistant', element: <Navigate to="/" replace /> },
          { path: '/assistant/c/:conversationId', element: <LegacyChatRedirect /> },
          {
            element: <AppShell />,
            errorElement: <RouteError />,
            children: [
              { path: '/dashboard', element: s(<DashboardPage />) },
              { path: '/history', element: s(<ChatHistoryPage />) },
              { path: '/clients', element: s(<ClientsPage />) },
              { path: '/clients/new', element: s(<ClientFormPage />) },
              { path: '/clients/:clientId', element: s(<ClientDetailPage tab="overview" />) },
              { path: '/clients/:clientId/edit', element: s(<ClientFormPage />) },
              { path: '/clients/:clientId/jobs', element: s(<ClientDetailPage tab="jobs" />) },
              { path: '/clients/:clientId/brand', element: s(<ClientDetailPage tab="brand" />) },
              { path: '/clients/:clientId/reference-files', element: s(<ClientDetailPage tab="files" />) },
              { path: '/clients/:clientId/activity', element: s(<ClientDetailPage tab="activity" />) },
              { path: '/jobs', element: s(<JobsPage />) },
              { path: '/jobs/new', element: s(<JobFormPage />) },
              { path: '/jobs/:jobId', element: s(<JobDetailPage />) },
              { path: '/jobs/:jobId/edit', element: s(<JobFormPage />) },
              { path: '/tasks', element: s(<TasksPage />) },
              { path: '/tasks/new', element: s(<TaskFormPage />) },
              { path: '/tasks/:taskId', element: s(<TaskDetailPage />) },
              { path: '/tasks/:taskId/edit', element: s(<TaskFormPage />) },
              { path: '/tasks/:taskId/workspace', element: s(<AiWorkspacePage />) },
              { path: '/ai-workspace', element: s(<AiWorkspaceHome />) },
              { path: '/ai-workspace/:taskId', element: s(<AiWorkspacePage />) },
              { path: '/files', element: s(<FilesPage />) },
              { path: '/files/:fileId', element: s(<FileDetailPage />) },
              { path: '/approved', element: s(<ApprovedWorkPage />) },
              { path: '/search', element: s(<SearchPage />) },
              { path: '/image-presets', element: s(<PresetsPage />) },
              { path: '/image-presets/new', element: s(<PresetEditorPage />) },
              { path: '/image-presets/:presetId/edit', element: s(<PresetEditorPage />) },
              { path: '/ai-instructions', element: s(<AiInstructionsPage />) },
              { path: '/team', element: s(<TeamPage />) },
              {
                path: '/settings',
                element: s(<SettingsLayout />),
                children: [
                  { index: true, element: s(<SettingsOverviewPage />) },
                  { path: 'profile', element: s(<ProfileSettingsPage />) },
                  { path: 'preferences', element: s(<PreferencesSettingsPage />) },
                  { path: 'storage', element: s(<StorageSettingsPage />) },
                  { path: 'security', element: s(<SecuritySettingsPage />) },
                ],
              },
              { path: '/not-found', element: s(<NotFoundPage />) },
              { path: '*', element: s(<NotFoundPage />) },
            ],
          },
        ],
      },
    ],
  },
]);
