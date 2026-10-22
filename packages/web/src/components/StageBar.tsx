import { STAGE_LABELS, stageProgress } from '../lib/format';

export function StageBar({ stages, current }: { stages: string[]; current: string }) {
  const { index, done } = stageProgress(stages, current);
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label="阶段">
      {stages.map((stage, i) => {
        const state = done || i < index ? 'past' : i === index ? 'current' : 'future';
        return (
          <li key={stage} className="flex items-center gap-1">
            <span
              aria-current={state === 'current' ? 'step' : undefined}
              className={
                state === 'current'
                  ? 'rounded-full bg-zinc-900 px-2.5 py-1 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : state === 'past'
                    ? 'rounded-full bg-zinc-200 px-2.5 py-1 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                    : 'rounded-full px-2.5 py-1 text-zinc-400 ring-1 ring-zinc-200 dark:text-zinc-500 dark:ring-zinc-800'
              }
            >
              {STAGE_LABELS[stage] ?? stage}
            </span>
            {i < stages.length - 1 && <span className="text-zinc-300 dark:text-zinc-700">›</span>}
          </li>
        );
      })}
    </ol>
  );
}
