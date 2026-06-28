import type { ActionDefinition, ActionHandler } from '../roleActionRegistry';

// ─── Handlers ─────────────────────────────────────────────────────────────────

const createKnowledgeHandler: ActionHandler = async (params, scope) => {
  const { knowledgeService } = await import('../../knowledgeService');

  const title = (params.title as string)?.trim();
  const content = (params.content as string)?.trim();
  const category = (params.category as string)?.trim() || 'general';

  if (!title) return { answer: 'What title should the knowledge entry have?' };
  if (!content) return { answer: 'What content should the knowledge entry contain?' };

  try {
    const entry = await knowledgeService.create(
      { sub: scope.userId, role: scope.role, schoolId: scope.schoolId, departmentId: scope.departmentId } as any,
      { title, content, category },
    );

    return {
      answer: `✅ Knowledge entry **"${entry.title}"** created (${entry.scopeLevel} scope).`,
      data: { entryId: entry.id, title: entry.title, scopeLevel: entry.scopeLevel },
    };
  } catch (err) {
    return { answer: err instanceof Error ? err.message : 'Failed to create knowledge entry.' };
  }
};

const listKnowledgeHandler: ActionHandler = async (_params, scope) => {
  const { knowledgeService } = await import('../../knowledgeService');

  try {
    const result = await knowledgeService.list(
      { sub: scope.userId, role: scope.role, schoolId: scope.schoolId, departmentId: scope.departmentId } as any,
      1,
      50,
    );

    if (result.entries.length === 0) {
      return { answer: 'No knowledge entries found for your scope.' };
    }

    const lines = result.entries.map((e, i) =>
      `${i + 1}. **${e.title}** (${e.scopeLevel}) — ${e.category} — by ${e.creatorName}`
    );

    return {
      answer: `📚 **Knowledge Base** (${result.total} entries)\n\n${lines.join('\n')}`,
      data: { count: result.total, entries: result.entries },
    };
  } catch (err) {
    return { answer: err instanceof Error ? err.message : 'Failed to list knowledge entries.' };
  }
};

const searchKnowledgeHandler: ActionHandler = async (params, scope) => {
  const { prisma } = await import('../../../lib/prisma');

  const query = (params.query as string)?.trim();
  if (!query) return { answer: 'What would you like to search for?' };

  const where: Record<string, unknown> = { schoolId: scope.schoolId };
  if (scope.role === 'HOD' && scope.departmentId) {
    where.OR = [
      { departmentId: null, classId: null },
      { departmentId: scope.departmentId },
    ];
  }

  const entries = await prisma.aIKnowledge.findMany({
    where: {
      ...where,
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } },
      ],
    },
    include: { createdBy: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  if (entries.length === 0) {
    return { answer: `No knowledge entries match "${query}".` };
  }

  const lines = entries.map((e, i) =>
    `${i + 1}. **${e.title}** — ${e.content.slice(0, 100)}...`
  );

  return {
    answer: `🔍 **Search: "${query}"** (${entries.length} results)\n\n${lines.join('\n')}`,
    data: { query, count: entries.length, entries },
  };
};

// ─── Action Definitions ───────────────────────────────────────────────────────

export const knowledgeActions: ActionDefinition[] = [
  {
    action: 'create_knowledge',
    description: 'Create a knowledge base entry (title, content, category) — available to school admins, HODs, and teachers',
    destructive: false,
    patterns: [
      /(?:add|create)\s+(?:a\s+)?knowledge\s+(?:entry|article)\s*(?:for|about)?\s*(.+)/i,
      /save\s+(?:a\s+)?(?:note|knowledge)\s+(?:entry)\s*(?:for|about)?\s*(.+)/i,
    ],
    extractParams: (message: string, match: RegExpMatchArray | null) => {
      const remainder = match?.[1]?.trim() || '';
      return { title: remainder };
    },
    descriptionTemplate: (params) =>
      `Create a knowledge entry${params.title ? ` about "${params.title}"` : ''}.`,
    handler: createKnowledgeHandler,
  },
  {
    action: 'list_knowledge',
    description: 'List knowledge base entries available to your role',
    destructive: false,
    patterns: [
      /(?:list|show|view)\s+(?:knowledge|kb|articles?|notes?)/i,
      /what\s+(?:knowledge|info|information)\s+(?:is\s+)?available/i,
    ],
    extractParams: () => ({}),
    descriptionTemplate: () => 'List knowledge base entries.',
    handler: listKnowledgeHandler,
  },
  {
    action: 'search_knowledge',
    description: 'Search knowledge base entries by keyword',
    destructive: false,
    patterns: [
      /search\s+(?:knowledge|kb|articles?|notes?)\s+(?:for\s+)?(.+)/i,
      /find\s+(?:knowledge|info)\s+(?:about\s+)?(.+)/i,
    ],
    extractParams: (_message: string, match: RegExpMatchArray | null) => ({
      query: match?.[1]?.trim() || '',
    }),
    descriptionTemplate: (params) =>
      `Search knowledge base for "${params.query}".`,
    handler: searchKnowledgeHandler,
  },
];
