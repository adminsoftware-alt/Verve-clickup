import { describe, expect, it } from 'vitest';
import { toTokens } from './commentText';

describe('toTokens', () => {
  const ann = { kind: 'user' as const, id: 'u1', label: 'Ann' };
  const annLee = { kind: 'user' as const, id: 'u2', label: 'Ann Lee' };

  it('turns a picked @Name into its token', () => {
    expect(toTokens('Thanks @Ann!', [ann])).toBe('Thanks @[Ann](user:u1)!');
  });

  it('prefers the longer name', () => {
    expect(toTokens('@Ann Lee and @Ann', [ann, annLee])).toBe('@[Ann Lee](user:u2) and @[Ann](user:u1)');
  });

  it('leaves names that are only the start of a word, and existing tokens', () => {
    expect(toTokens('@Annual report', [ann])).toBe('@Annual report');
    expect(toTokens('@[Ann](user:u1)', [ann])).toBe('@[Ann](user:u1)');
  });

  it('handles Teams and names with symbols', () => {
    expect(toTokens('cc @Tax (Direct)', [{ kind: 'team', id: 't9', label: 'Tax (Direct)' }])).toBe('cc @[Tax (Direct)](team:t9)');
  });
});
