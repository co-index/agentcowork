import { describe, expect, it } from 'vitest';
import {
  MsgPostInput,
  RoleSchema,
  RoomCreateInput,
  SlugSchema,
  initialStage,
} from '../src/index.js';

describe('shared schemas', () => {
  it('accepts built-in and custom roles only', () => {
    expect(RoleSchema.safeParse('frontend').success).toBe(true);
    expect(RoleSchema.safeParse('custom:data-eng').success).toBe(true);
    expect(RoleSchema.safeParse('hacker').success).toBe(false);
    expect(RoleSchema.safeParse('custom:').success).toBe(false);
  });

  it('validates slugs', () => {
    expect(SlugSchema.safeParse('REQ-123').success).toBe(true);
    expect(SlugSchema.safeParse('-bad').success).toBe(false);
    expect(SlugSchema.safeParse('has space').success).toBe(false);
  });

  it('defaults room type and message kind', () => {
    expect(RoomCreateInput.parse({ title: 't', role: 'backend' }).type).toBe('feature');
    const post = MsgPostInput.parse({
      room: 'r',
      participant_id: 'p',
      content: 'hi',
      expected_last_seq: 0,
      reply_token: 'rt',
    });
    expect(post.kind).toBe('chat');
  });

  it('agents cannot post system messages', () => {
    const res = MsgPostInput.safeParse({
      room: 'r',
      participant_id: 'p',
      content: 'hi',
      kind: 'system',
      expected_last_seq: 0,
      reply_token: 'rt',
    });
    expect(res.success).toBe(false);
  });

  it('picks the first stage per room type', () => {
    expect(initialStage('feature')).toBe('briefing');
    expect(initialStage('bug')).toBe('report');
  });
});
