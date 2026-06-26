import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_CHARS = 12_000;

type TerminalCommandKey =
  | 'status'
  | 'test'
  | 'logs'
  | 'verify'
  | 'readiness'
  | 'secrets'
  | 'diagnose-ai'
  | 'traffic'
  | 'restart-api'
  | 'ready-app-only'
  | 'migrate-status'
  | 'migrate-deploy'
  | 'unlock-users'
  | 'pm2-save'
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
  test: {
    key: 'test',
    label: 'SAMS production smoke test',
    command: 'bash',
    args: ['scripts/super-admin-test.sh'],
    timeoutMs: 240_000,
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
  readiness: {
    key: 'readiness',
    label: 'Production readiness check',
    command: 'bash',
    args: ['scripts/production-readiness-check.sh'],
    timeoutMs: 120_000,
  },
  secrets: {
    key: 'secrets',
    label: 'Provider secrets check',
    command: 'bash',
    args: ['scripts/verify-secrets.sh'],
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
  'ready-app-only': {
    key: 'ready-app-only',
    label: 'Switch to app-only production mode',
    command: 'bash',
    args: ['scripts/ready-app-only-production.sh'],
    timeoutMs: 180_000,
  },
  'migrate-status': {
    key: 'migrate-status',
    label: 'Prisma migration status',
    command: 'npx',
    args: ['prisma', 'migrate', 'status', '--schema', 'packages/backend/prisma/schema.prisma'],
    timeoutMs: 120_000,
  },
  'migrate-deploy': {
    key: 'migrate-deploy',
    label: 'Deploy pending Prisma migrations',
    command: 'npx',
    args: ['prisma', 'migrate', 'deploy', '--schema', 'packages/backend/prisma/schema.prisma'],
    timeoutMs: 180_000,
  },
  'unlock-users': {
    key: 'unlock-users',
    label: 'Unlock users',
    command: 'bash',
    args: ['scripts/unlock-users.sh'],
    timeoutMs: 180_000,
  },
  'pm2-save': {
    key: 'pm2-save',
    label: 'Save PM2 process list',
    command: 'pm2',
    args: ['save'],
    timeoutMs: 30_000,
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
  test: 'test',
  smoke: 'test',
  'smoke test': 'test',
  'production test': 'test',
  logs: 'logs',
  log: 'logs',
  'api logs': 'logs',
  verify: 'verify',
  check: 'verify',
  'post deploy verify': 'verify',
  'post-deploy-verify': 'verify',
  readiness: 'readiness',
  'readiness check': 'readiness',
  'production readiness': 'readiness',
  'production-readiness': 'readiness',
  secrets: 'secrets',
  'verify secrets': 'secrets',
  'verify-secrets': 'secrets',
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
  'app only': 'ready-app-only',
  'app-only': 'ready-app-only',
  'ready app only': 'ready-app-only',
  'ready-app-only': 'ready-app-only',
  'migrate status': 'migrate-status',
  'migration status': 'migrate-status',
  'migrate-status': 'migrate-status',
  'migrate deploy': 'migrate-deploy',
  'migration deploy': 'migrate-deploy',
  'migrate-deploy': 'migrate-deploy',
  'unlock users': 'unlock-users',
  'unlock-users': 'unlock-users',
  unlock: 'unlock-users',
  'pm2 save': 'pm2-save',
  'pm2-save': 'pm2-save',
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
    '- @test - post-deploy verification plus traffic smoke test',
    '- @logs - last SAMS API logs',
    '- @verify - post-deploy verification',
    '- @readiness - production readiness checks',
    '- @secrets - masked provider/secrets check',
    '- @diagnose-ai - AI provider diagnostics',
    '- @traffic - light authenticated/readiness traffic check',
    '- @restart-api - restart the SAMS API',
    '- @ready-app-only - disable SMS-dependent features and keep app notifications only',
    '- @migrate-status - Prisma migration status',
    '- @migrate-deploy - apply pending Prisma migrations',
    '- @unlock-users - remove login cooldown/blocked flags',
    '- @pm2-save - save the PM2 process list',
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
  let stdout = '';
  let stderr = '';

  try {
    const result = await execFileAsync(definition.command, definition.args, {
      cwd,
      timeout: definition.timeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: {
        ...process.env,
        ...definition.env,
      },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err) {
    const execErr = err as Error & { stdout?: string; stderr?: string; code?: number | string };
    const output = truncateOutput(
      [
        execErr.stdout,
        execErr.stderr,
        `Command failed${execErr.code ? ` with exit code ${execErr.code}` : ''}: ${execErr.message}`,
      ].filter(Boolean).join('\n'),
    );
    throw new Error(output);
  }

  const output = truncateOutput([stdout, stderr].filter(Boolean).join('\n'));
  return {
    key: definition.key,
    label: definition.label,
    commandPreview: [definition.command, ...definition.args].map(shellEscapePreview).join(' '),
    output,
  };
}
