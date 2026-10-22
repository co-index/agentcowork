import type { MessageView } from '@agentcowork/shared';

/** Position of `current` in the stage list, for the progress bar. */
export function stageProgress(stages: readonly string[], current: string) {
  const index = Math.max(0, stages.indexOf(current));
  return { index, total: stages.length, done: current === 'done' };
}

/** Short relative time such as "刚刚", "3 分钟前", "2 小时前", or a date. */
export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return '—';
  const diff = Math.max(0, now - Date.parse(iso));
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

const ROLE_COLORS = [
  'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200',
];

/** Stable badge color per role. */
export function roleColor(role: string): string {
  let h = 0;
  for (const ch of role) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ROLE_COLORS[h % ROLE_COLORS.length]!;
}

/** Inserts or replaces by seq, keeping ascending order (SSE and history can overlap). */
export function mergeMessages(current: MessageView[], incoming: MessageView[]): MessageView[] {
  const bySeq = new Map(current.map((m) => [m.seq, m]));
  for (const m of incoming) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** Orders board sections the way the design lists them, unknown keys last. */
export function sortBoardKeys(keys: string[]): string[] {
  const order = [
    'requirement',
    'context',
    'contract',
    'plan',
    'decisions',
    'open_questions',
    'todos',
    'bug',
  ];
  const rank = (k: string) => {
    const i = order.indexOf(k.split('.')[0]!);
    return i === -1 ? order.length : i;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export const STAGE_LABELS: Record<string, string> = {
  briefing: '简报',
  research: '调研',
  discuss: '讨论',
  propose: '提方案',
  align: '对齐',
  finalize: '定稿',
  done: '完成',
  report: '报告',
  investigate: '排查',
  locate: '定位',
  fix: '修复',
  verify: '验证',
};

export const STATUS_LABELS: Record<string, string> = {
  online: '思考中',
  waiting: '在听',
  offline: '离线',
  left: '已离开',
};
