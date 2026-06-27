import { prisma } from '../lib/prisma';

export interface BatchCriteria {
  status?: 'suspended' | 'expired' | 'active' | 'all';
  planTier?: string;
  daysThreshold?: number;
  search?: string;
}

export interface BatchResolveResult {
  schoolIds: string[];
  schoolNames: string[];
  total: number;
  criteria: BatchCriteria;
}

function extractBatchCriteria(text: string): BatchCriteria {
  const lower = text.toLowerCase();
  const criteria: BatchCriteria = {};

  if (/\bexpired\b.*\b(?:license|licence|ses)\b|\b(?:license|licence|ses)\b.*\bexpired\b/.test(lower)) {
    criteria.status = 'expired';
  } else if (/\bsuspended?\b|\bblocked?\b|\bdisabled?\b/.test(lower)) {
    criteria.status = 'suspended';
  } else if (/\b(?:active|non.?expired|live)\b/.test(lower)) {
    criteria.status = 'active';
  }

  const tierMatch = lower.match(/\b(trial|basic|professional|enterprise)\b/i);
  if (tierMatch) criteria.planTier = tierMatch[1].toUpperCase();

  const daysMatch = lower.match(/(\d+)\s*days?/i);
  if (daysMatch) {
    criteria.daysThreshold = parseInt(daysMatch[1], 10);
  } else if (/\blast\s+month\b|\bprevious\s+month\b/i.test(lower)) {
    criteria.daysThreshold = 30;
  } else if (/\blast\s+week\b|\bprevious\s+week\b/i.test(lower)) {
    criteria.daysThreshold = 7;
  }

  const searchMatch = text.match(/named?\s+["']?([^"']+)["']?/i) || text.match(/(?:called|named)\s+(\S+(?:\s+\S+)?)/i);
  if (searchMatch) criteria.search = searchMatch[1].trim();

  return criteria;
}

export function describeBatchParams(params: Record<string, unknown>): string {
  const criteria = params.criteria as BatchCriteria | undefined;
  if (!criteria) return String(params.description ?? 'selected schools');
  const parts: string[] = [];
  if (criteria.status) parts.push(criteria.status);
  if (criteria.planTier) parts.push(`${criteria.planTier} plan`);
  if (criteria.daysThreshold) parts.push(`within ${criteria.daysThreshold} days`);
  if (criteria.search) parts.push(`matching "${criteria.search}"`);
  return parts.length > 0 ? parts.join(' ') : 'all schools';
}

export async function resolveBatchSchools(params: Record<string, unknown>): Promise<BatchResolveResult> {
  const rawDescription = String(params.description ?? params.criteria ?? '');
  const criteria: BatchCriteria = typeof params.criteria === 'object' && params.criteria !== null
    ? params.criteria as BatchCriteria
    : extractBatchCriteria(rawDescription);

  const where: Record<string, unknown> = {};
  const now = new Date();

  if (criteria.status === 'suspended') where.isSuspended = true;
  else if (criteria.status === 'expired') {
    where.licenseExpiresAt = { lt: now };
    where.isSuspended = false;
  } else if (criteria.status === 'active') {
    where.licenseExpiresAt = { gte: now };
    where.isSuspended = false;
  }

  if (criteria.planTier) where.planTier = criteria.planTier;

  if (criteria.search) {
    where.OR = [
      { name: { contains: criteria.search, mode: 'insensitive' } },
      { schoolCode: { contains: criteria.search, mode: 'insensitive' } },
    ];
  }

  const schools = await prisma.school.findMany({
    where: where as any,
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return {
    schoolIds: schools.map((s) => s.id),
    schoolNames: schools.map((s) => s.name),
    total: schools.length,
    criteria,
  };
}

export function detectBatchOperation(text: string): {
  isBatch: boolean;
  operation: string | null;
  criteriaText: string;
} {
  const lower = text.toLowerCase().trim();

  const batchPatterns = [
    /\b(?:all|every)\s+(?:suspended|expired|active|trial|basic|professional|enterprise)\s+school/i,
    /\bschools?\s+that\s+(?:are|have|were)\s+(?:suspended|expired)/i,
    /\bschools?\s+(?:on|with)\s+(?:trial|basic|professional|enterprise)\s+(?:plan|tier)/i,
    /\bbatch\s+(?:suspend|unsuspend|extend|change|notify|send)/i,
    /\bbulk\s+(?:suspend|unsuspend|extend|change|notify|send)/i,
  ];

  const isBatch = batchPatterns.some((p) => p.test(text));

  let operation: string | null = null;
  if (/suspend/i.test(text) && /(?:all|every|schools|batch|bulk)/i.test(text)) operation = 'suspend_school';
  else if (/unsuspend/i.test(text) && /(?:all|every|schools|batch|bulk)/i.test(text)) operation = 'unsuspend_school';
  else if (/extend/i.test(text) && /(?:all|every|schools|batch|bulk)/i.test(text)) operation = 'extend_license';
  else if (/\b(?:send|notify)\b/i.test(text) && /(?:all|every|schools|batch|bulk)/i.test(text)) operation = 'batch_send_notification';
  else if (/\bchange\s+plan\b|\bupgrade\b|\bdowngrade\b/i.test(text)) operation = 'batch_change_plan';

  return { isBatch, operation, criteriaText: text };
}
