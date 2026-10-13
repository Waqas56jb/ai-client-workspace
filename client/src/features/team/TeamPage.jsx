import { useState } from 'react';
import { Info, Mail, Pencil, Users } from 'lucide-react';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Page, PageHeader, SkeletonRows, Table, Td, Th } from '@/components/ui';
import { useBreadcrumbs, usePageTitle, useUsers } from '@/hooks';
import { useAuthStore } from '@/store/authStore';
import { formatDateTime, timeAgo } from '@/lib/utils';
import { ProfileDialog } from './ProfileDialog';
import { isMockMode } from '@/lib/config';

export default function TeamPage() {
  usePageTitle('Team');
  useBreadcrumbs([{ label: 'Team' }]);
  const { data: users, isLoading, error, refetch } = useUsers();
  const me = useAuthStore((s) => s.user);
  const [editing, setEditing] = useState(null);

  return (
    <Page>
      <PageHeader title="Team" description="Everyone with access to this StudioFlow AI workspace." />

      <div className="mb-5 flex gap-2.5 rounded-xl border border-info/20 bg-info-soft px-4 py-3 text-[13px] leading-5 text-[#1F4E9E]">
        <Info size={16} className="mt-0.5 shrink-0 text-info" aria-hidden />
        {isMockMode ? (
          <p>
            The first release supports <strong className="font-semibold">three users with shared workspace access</strong>; role-based restrictions are not in scope. Real
            authentication and persistent user records arrive with the backend — editing these demo records does not create or change real accounts.
          </p>
        ) : (
          <p>
            All members share the same workspace access. You can edit <strong className="font-semibold">your own</strong> profile (name, role and avatar colour); accounts,
            sign-in emails and active status are managed by the workspace administrator.
          </p>
        )}
      </div>

      {isLoading ? (
        <Card className="p-5">
          <SkeletonRows rows={3} />
        </Card>
      ) : error ? (
        <Card>
          <ErrorState error={error} onRetry={refetch} />
        </Card>
      ) : !users?.length ? (
        <Card>
          <EmptyState icon={Users} title="No team members" description="Team members will appear here once the workspace is set up." />
        </Card>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Role</Th>
              <Th>Last active</Th>
              <Th>Status</Th>
              <Th className="text-right">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-canvas/50">
                <Td>
                  <div className="flex items-center gap-3">
                    <Avatar user={u} size="lg" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-semibold text-ink">{u.name}</span>
                        {me?.id === u.id && <Badge tone="brand">You</Badge>}
                      </div>
                      <a href={`mailto:${u.email}`} className="inline-flex items-center gap-1 rounded text-xs text-muted hover:text-brand focus-ring">
                        <Mail size={12} aria-hidden /> {u.email}
                      </a>
                    </div>
                  </div>
                </Td>
                <Td className="text-ink">{u.role}</Td>
                <Td>
                  <time dateTime={u.lastActiveAt} title={formatDateTime(u.lastActiveAt)} className="text-muted">
                    {timeAgo(u.lastActiveAt)}
                  </time>
                </Td>
                <Td>
                  <Badge tone={u.status === 'active' ? 'success' : 'neutral'} dot>
                    {u.status === 'active' ? 'Active' : 'Inactive'}
                  </Badge>
                </Td>
                <Td className="text-right">
                  {(isMockMode || me?.id === u.id) && (
                    <Button size="sm" icon={Pencil} onClick={() => setEditing(u)} aria-label={`Edit profile for ${u.name}`}>
                      Edit profile
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <ProfileDialog user={editing} open={!!editing} onClose={() => setEditing(null)} />
    </Page>
  );
}
