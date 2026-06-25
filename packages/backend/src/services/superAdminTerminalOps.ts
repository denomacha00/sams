import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_CHARS = 12_000;

type TerminalCommandKey =
  | 'status'
  | 'logs'
  | 'verify'
  | 'diagnose-ai'
  | 'traffic'
  | 'restart-api'
  | 'git-status'
  | 'git-pull'
  | 'deploy';

interface TerminalCommandDefinition {
  key: TerminalCommandKey;
  label: string;
  command: string;
  args: string[];
  timeoutMs: number;
  env?: Record<string, string>;
}

export interface TerminalCommandResult {
  key: TerminalCommandKey;
  label: string;
  commandPreview: string;
  output: string;
}

function getSamsRoot(): string {
  return process.env.SAMS_ROOT?.trim() || process.cwd();
}

function normalizeCommand(input: string): string {
  return input
    .trim()
    .replace(/^@+/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function truncateOutput(output: string): string {
  const clean = output.trim();
  if (clean.length <= MAX_OUTPUT_CHARS) return clean || '(no output)';
  return `${clean.slice(0, MAX_OUTPUT_CHARS)}\n\n[output truncated at ${MAX_OUTPUT_CHARS} characters]`;
}

function shellEscapePreview(value: string): string {
  if (/^[a-zA-Z0-9_./:=@-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

const COMMANDS: Record<TerminalCommandKey, TerminalCommandDefinition> = {
  status: {
    key: 'status',
    label: 'PM2 status',
    command: 'pm2',
    args: ['status'],
    timeoutMs: 20_000,
  },
  logs: {
    key: 'logs',
    label: 'SAMS API logs',
    command: 'pm2',
    args: ['logs', 'sams-api', '--lines', '120', '--nostream'],
    timeoutMs: 30_000,
  },
  verify: {
    key: 'verify',
    label: 'Post-deploy verification',
    command: 'bash',
    args: ['scripts/post-deploy-verify.sh'],
    timeoutMs: 120_000,
  },
  'diagnose-ai': {
    key: 'diagnose-ai',
    label: 'AI diagnostics',
    command: 'bash',
    args: ['scripts/diagnose-ai.sh'],
    timeoutMs: 120_000,
  },
  traffic: {
    key: 'traffic',
    label: 'Traffic readiness check',
    command: 'bash',
    args: ['scripts/traffic-readiness-check.sh'],
    timeoutMs: 180_000,
    env: { REQUESTS: '800', CONCURRENCY: '40' },
  },
  'restart-api': {
    key: 'restart-api',
    label: 'Restart SAMS API',
    command: 'bash',
    args: ['scripts/restart-api.sh'],
    timeoutMs: 120_000,
  },
  'git-status': {
    key: 'git-status',
    label: 'Git status',
    command: 'git',
    args: ['status', '--short', '--branch'],
    timeoutMs: 30_000,
  },
  'git-pull': {
    key: 'git-pull',
    label: 'Git pull main',
    command: 'git',
    args: ['pull', 'origin', 'main'],
    timeoutMs: 120_000,
  },
  deploy: {
    key: 'deploy',
    label: 'Production deploy',
    command: 'bash',
    args: ['scripts/deploy-production.sh'],
    timeoutMs: 600_000,
  },
};

const ALIASES: Record<string, TerminalCommandKey> = {
  status: 'status',
  'pm2 status': 'status',
  logs: 'logs',
  log: 'logs',
  'api logs': 'logs',
  verify: 'verify',
  check: 'verify',
  'post deploy verify': 'verify',
  'post-deploy-verify': 'verify',
  diagnose: 'diagnose-ai',
  'diagnose ai': 'diagnose-ai',
  'diagnose-ai': 'diagnose-ai',
  ai: 'diagnose-ai',
  traffic: 'traffic',
  load: 'traffic',
  'load test': 'traffic',
  restart: 'restart-api',
  'restart api': 'restart-api',
  'restart-api': 'restart-api',
  'git status': 'git-status',
  'git-status': 'git-status',
  pull: 'git-pull',
  'git pull': 'git-pull',
  'git-pull': 'git-pull',
  deploy: 'deploy',
  'deploy production': 'deploy',
  'deploy-production': 'deploy',
};

export function listTerminalCommandHelp(): string {
  return [
    'Super Admin terminal commands use @ and must be confirmed before running:',
    '',
    '- @db - live database overview (handled by SAMS, not shell)',
    '- @status - PM2 process status',
    '- @logs - last SAMS API logs',
    '- @verify - post-deploy verification',
    '- @diagnose-ai - AI provider diagnostics',
    '- @traffic - light authenticated/readiness traffic check',
    '- @restart-api - restart the SAMS API',
    '- @git-status - git branch and changed files',
    '- @git-pull - pull latest main from GitHub',
    '- @deploy - run production deploy',
  ].join('\n');
}

export function resolveTerminalCommand(input: string): TerminalCommandDefinition | null {
  const normalized = normalizeCommand(input);
  const key = ALIASES[normalized];
  return key ? COMMANDS[key] : null;
}

export function isTerminalCommandRequest(input: string): boolean {
  return input.trim().startsWith('@');
}

export async function runSafeTerminalCommand(input: string): Promise<TerminalCommandResult> {
  const definition = resolveTerminalCommand(input);
  if (!definition) {
    throw new Error(`Unknown or blocked terminal command. ${listTerminalCommandHelp()}`);
  }

  const cwd = path.resolve(getSamsRoot());
  const { stdout, stderr } = await execFileAsync(definition.command, definition.args, {
    cwd,
    timeout: definition.timeoutMs,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    env: {
      ...process.env,
      ...definition.env,
    },
  });

  const output = truncateOutput([stdout, stderr].filter(Boolean).join('\n'));
  return {
    key: definition.key,
    label: definition.label,
    commandPreview: [definition.command, ...definition.args].map(shellEscapePreview).join(' '),
    output,
  };
}
