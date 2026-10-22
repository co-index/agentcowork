import type { RoomDetail } from '../lib/api';
import { roleColor, STATUS_LABELS } from '../lib/format';

const DOT: Record<string, string> = {
  waiting: 'bg-emerald-500',
  online: 'bg-amber-500 animate-pulse',
  offline: 'bg-zinc-400',
  left: 'bg-zinc-300',
};

export function Members({ members, hostId }: { members: RoomDetail['members']; hostId?: string }) {
  if (members.length === 0) return <p className="text-sm text-zinc-500">还没有成员加入</p>;
  return (
    <ul className="flex flex-wrap gap-2">
      {members.map((m) => (
        <li
          key={m.participant_id}
          className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          title={m.repo ? `${m.repo.name}${m.repo.branch ? ` @ ${m.repo.branch}` : ''}` : undefined}
        >
          <span className={`size-2 rounded-full ${DOT[m.status] ?? 'bg-zinc-400'}`} />
          <span className="font-medium">{m.display_name}</span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${roleColor(m.role)}`}>{m.role}</span>
          <span className="text-xs text-zinc-500">{STATUS_LABELS[m.status] ?? m.status}</span>
          {m.participant_id === hostId && <span className="text-xs text-zinc-500">· 主持人</span>}
          {m.ready && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400" title="本阶段已 ready">
              ✓ ready
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
