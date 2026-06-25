import { describe, expect, it } from 'vitest';
import {
  isTerminalCommandRequest,
  listTerminalCommandHelp,
  resolveTerminalCommand,
} from './superAdminTerminalOps';

describe('superAdminTerminalOps', () => {
  it('requires @ prefix for terminal command requests', () => {
    expect(isTerminalCommandRequest('@status')).toBe(true);
    expect(isTerminalCommandRequest('status')).toBe(false);
  });

  it('resolves only allowlisted terminal commands', () => {
    expect(resolveTerminalCommand('@status')?.key).toBe('status');
    expect(resolveTerminalCommand('@pm2 status')?.key).toBe('status');
    expect(resolveTerminalCommand('@diagnose ai')?.key).toBe('diagnose-ai');
    expect(resolveTerminalCommand('@git pull')?.key).toBe('git-pull');
    expect(resolveTerminalCommand('@deploy')?.key).toBe('deploy');
  });

  it('blocks arbitrary shell commands', () => {
    expect(resolveTerminalCommand('@rm -rf /')).toBeNull();
    expect(resolveTerminalCommand('@cat secrets/providers.env')).toBeNull();
    expect(resolveTerminalCommand('@bash -c whoami')).toBeNull();
  });

  it('documents the allowed command list', () => {
    const help = listTerminalCommandHelp();
    expect(help).toContain('@status');
    expect(help).toContain('@deploy');
  });
});
