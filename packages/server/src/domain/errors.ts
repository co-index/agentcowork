import type { ErrorCode } from '@agentcowork/shared';

/** A business error with a stable code; transports turn it into a tool error / HTTP status. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}
