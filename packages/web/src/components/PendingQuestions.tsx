import type { RoomDetail } from '../lib/api';
import { targetLabel } from '../lib/format';

const EXCERPT = 80;

/** Unanswered questions and who still owes a reply; targets that are offline are highlighted. */
export function PendingQuestions({
  questions,
  members,
}: {
  questions: RoomDetail['pending_questions'];
  members: RoomDetail['members'];
}) {
  if (questions.length === 0) return null;
  const isOffline = (target: string) => {
    const matching = members.filter((m) => m.participant_id === target || m.role === target);
    return matching.length === 0 || matching.every((m) => m.status === 'offline');
  };
  const blocked = questions.filter((q) => q.waiting_on.some(isOffline)).length;
  return (
    <details className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
      <summary className="cursor-pointer text-xs font-medium text-zinc-600 dark:text-zinc-300">
        待回答的问题 {questions.length}
        {blocked > 0 && (
          <span className="ml-2 text-amber-700 dark:text-amber-400">
            其中 {blocked} 个在等不在线的成员
          </span>
        )}
      </summary>
      <ul className="mt-2 space-y-1.5">
        {questions.map((q) => (
          <li key={q.seq} className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="font-mono text-zinc-400">#{q.seq}</span>
            <span className="text-zinc-600 dark:text-zinc-300">{q.sender} 问</span>
            {q.waiting_on.map((t) => (
              <span
                key={t}
                className={
                  isOffline(t)
                    ? 'rounded bg-amber-100 px-1.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                    : 'rounded bg-zinc-100 px-1.5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                }
                title={isOffline(t) ? '不在线或还没加入' : undefined}
              >
                {targetLabel(t, members)}
              </span>
            ))}
            <span className="min-w-0 flex-1 truncate text-zinc-500" title={q.content}>
              {q.content.length > EXCERPT ? `${q.content.slice(0, EXCERPT)}…` : q.content}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
