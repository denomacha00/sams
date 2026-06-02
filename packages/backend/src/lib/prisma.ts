import './loadEnv';
import { PrismaClient } from '@prisma/client';

/** Shared Prisma client — import from here, not from index.ts (avoids circular deps). */
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
