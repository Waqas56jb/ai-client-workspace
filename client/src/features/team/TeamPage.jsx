import { useState } from 'react';
import { Info, KeyRound, Mail, Pencil, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Menu, Page, PageHeader, SkeletonRows, Table, Td, Th } from '@/components/ui';
import { useBreadcrumbs, usePageTitle, useServiceMutation, useUsers } from '@/hooks';
import { userService } from '@/services';
import { useAuthStore } from '@/store/authStore';
import { formatDateTime, timeAgo } from '@/lib/utils';
import { ProfileDialog } from './ProfileDialog';
import { AddMemberDialog, PasswordDialog } from './MemberDialogs';
import { isMockMode } from '@/lib/config';

export default function TeamPage() {
  usePageTitle('Team');
  useBreadcrumbs([{ label: 'Team' }]);
  const { data: users, isLoading, error, refetch } = useUsers();
  const me = useAuthStore((s) => s.user);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [passwordFor, setPasswordFor] = useState(null);
  const [removing, setRemoving] = useState(null);
  const isAdmin = !isMockMode && !!me?.isAdmin;
  const remove = useServiceMutation((u) => userService.remove(u.id), {
    success: (_, u) => `${u.name} was removed and can no longer sign in`,
    onSuccess: () => setRemoving(null),
  });

  return (
    <Page>
      <PageHeader
        title="Team"
        description="Everyone with access to this StudioFlow AI workspace."
        actions={
          isAdmin && (
            <Button variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>
              Add member
            </Button>
          )
        }
      />

      <div className="mb-5 flex gap-2.5 rounded-xl border border-info/20 bg-info-soft px-4 py-3 text-[13px] leading-5 text-[#1F4E9E]">
        <Info size={16} className="mt-0.5 shrink-0 text-info" aria-hidden />
        {isMockMode ? (
          <p>
            The first release supports <strong className="font-semibold">three users with shared workspace access</strong>; role-based restrictions are not in scope. Real
            authentication and persistent user records arrive with the backend — editing these demo records does not create or change real accounts.
          </p>
        ) : isAdmin ? (
          <p>
            You are an <strong className="font-semibold">administrator</strong>: add people, change their passwords or remove them. Removed people can no longer sign in;
            their past work stays in the workspace. Nobody can create an account on their own.
          </p>
        ) : (
          <p>
            All members share the same workspace access. You can edit <strong className="font-semibold">your own</strong> profile (name, role and avatar colour); accounts and
            passwords are managed by the workspace administrator.
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
                        {u.isAdmin && (
                          <Badge tone="neutral">
                            <ShieldCheck size={12} className="mr-0.5" aria-hidden /> Admin
                          </Badge>
                        )}
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
                  <div className="flex items-center justify-end gap-1.5">
                    {(isMockMode || me?.id === u.id) && (
                      <Button size="sm" icon={Pencil} onClick={() => setEditing(u)} aria-label={`Edit profile for ${u.name}`}>
                        Edit profile
                      </Button>
                    )}
                    {isAdmin && me?.id !== u.id && (
                      <Menu
                        label={`Manage ${u.name}`}
                        width={210}
                        items={[
                          { label: 'Change password', icon: KeyRound, onSelect: () => setPasswordFor(u) },
                          { label: 'Delete account', icon: Trash2, danger: true, onSelect: () => setRemoving(u) },
                        ]}
                      />
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <ProfileDialog user={editing} open={!!editing} onClose={() => setEditing(null)} />
      <AddMemberDialog open={adding} onClose={() => setAdding(false)} />
      <PasswordDialog user={passwordFor} open={!!passwordFor} onClose={() => setPasswordFor(null)} />
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => remove.mutate(removing)}
        loading={remove.isPending}
        tone="danger"
        icon={Trash2}
        title={`Delete ${removing?.name}’s account?`}
        description="They are signed out and can no longer sign in. Chats, drafts and approvals they made stay in the workspace."
        confirmLabel="Delete account"
      />
    </Page>
  );
}
