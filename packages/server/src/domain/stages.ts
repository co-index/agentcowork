import { BUG_STAGES, FEATURE_STAGES, type RoomType, type Stage } from '@agentcowork/shared';

/** Per-participant speaking limit for each stage (design 8.3). `null` means unlimited. */
const FEATURE_LIMITS: Record<(typeof FEATURE_STAGES)[number], number | null> = {
  briefing: null,
  research: 3,
  discuss: 8,
  propose: 5,
  align: 8,
  finalize: 3,
  done: null,
};

const BUG_LIMITS: Record<(typeof BUG_STAGES)[number], number | null> = {
  report: null,
  investigate: 8,
  locate: 8,
  fix: 5,
  verify: 5,
  done: null,
};

/** Default room-wide cap on agent messages before the room pauses for a human. */
export const ROOM_MESSAGE_BUDGET = 300;

/** A room with no new message for this long is paused so agents stop polling. */
export const IDLE_PAUSE_MS = 30 * 60 * 1000;

export function stagesFor(type: RoomType): readonly Stage[] {
  return type === 'feature' ? FEATURE_STAGES : BUG_STAGES;
}

export function isStageOf(type: RoomType, stage: string): stage is Stage {
  return (stagesFor(type) as readonly string[]).includes(stage);
}

export function nextStage(type: RoomType, stage: Stage): Stage | undefined {
  const list = stagesFor(type);
  const i = list.indexOf(stage);
  return i >= 0 ? list[i + 1] : undefined;
}

export function speakingLimit(type: RoomType, stage: Stage): number | null {
  const table: Record<string, number | null> = type === 'feature' ? FEATURE_LIMITS : BUG_LIMITS;
  return table[stage] ?? null;
}
