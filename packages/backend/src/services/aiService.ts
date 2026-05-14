import { type AccessTokenPayload } from '@sams/shared';
import { localQuery, type AIQueryResult } from './ai/localEngine';
import { openaiQuery } from './ai/openaiEngine';
import { licenseService } from './licenseService';


// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIServiceResponse {
  answer: string;
  intent: string;
  engine: 'local' | 'openai';
  data?: unknown;
}

// ─── AI Service ───────────────────────────────────────────────────────────────

/**
 * AIService routes queries to the appropriate engine:
 * - Local engine first for all plans (regex-based, no external API)
 * - Falls back to OpenAI engine for Pro/Enterprise plans when local engine
 *   cannot resolve the query (returns 'unknown' intent)
 *
 * Requirements: 14.1, 14.7
 */
export class AIService {
  /**
   * Process a text query through the AI pipeline.
   * Routes to local engine first; falls back to OpenAI for Pro/Enterprise.
   */
  async query(user: AccessTokenPayload, question: string): Promise<AIServiceResponse> {
    // Try local engine first — wrapped in try-catch so it never throws
    let localResult: AIQueryResult;
    try {
      localResult = await localQuery(user, question);
    } catch (err) {
      console.error('[AIService] Local engine error:', err);
      // Return a helpful fallback instead of throwing
      return {
        answer: `I can help you with:\n• Attendance rates and percentages\n• Absent students today\n• Risk scores and at-risk students\n• Top students by attendance\n• Class attendance comparison\n• Timetable viewing and generation\n• Student counts\n• Active session status\n\nTry asking: "What is the attendance rate?" or "Show my timetable"`,
        intent: 'error_fallback',
        engine: 'local',
      };
    }

    // If local engine resolved the query, return it
    if (localResult.intent !== 'unknown') {
      return {
        answer: localResult.answer,
        intent: localResult.intent,
        engine: 'local',
        data: localResult.data,
      };
    }

    // Local engine couldn't resolve — check if OpenAI/Groq is available
    // Super Admin always gets AI access; for schools, check plan tier
    let hasAIAccess = false;
    try {
      if (user.role === 'SUPER_ADMIN') {
        hasAIAccess = true;
      } else {
        hasAIAccess = await licenseService.checkFeatureAccess(user.schoolId, 'ai');
      }
    } catch (err) {
      console.error('[AIService] License check failed:', err);
      // If license check fails, still allow if OPENAI_API_KEY is set
      hasAIAccess = !!process.env.OPENAI_API_KEY;
    }

    if (!hasAIAccess) {
      // Return the local engine's "unknown" response with help text
      return {
        answer: localResult.answer,
        intent: 'unknown',
        engine: 'local',
      };
    }

    // Route to OpenAI engine for Pro/Enterprise plans
    try {
      const openaiResult = await openaiQuery(user, question);

      // If OpenAI also couldn't resolve (feature gated or error), return scope message
      if (openaiResult.intent === 'feature_gated') {
        return {
          answer: localResult.answer,
          intent: 'unknown',
          engine: 'local',
        };
      }

      return {
        answer: openaiResult.answer,
        intent: openaiResult.intent,
        engine: 'openai',
        data: openaiResult.data,
      };
    } catch (err) {
      console.error('[AIService] OpenAI fallback failed:', err);
      // If OpenAI fails, return the local engine's help message
      return {
        answer: localResult.answer,
        intent: 'unknown',
        engine: 'local',
      };
    }
  }

  /**
   * Process a voice query (text from client-side speech-to-text).
   * The client performs speech-to-text conversion using Web Speech API,
   * then sends the transcribed text here for processing.
   *
   * Requirements: 14.6
   */
  async voiceQuery(user: AccessTokenPayload, transcription: string): Promise<AIServiceResponse> {
    // Voice queries are processed the same as text queries
    // The client handles speech-to-text conversion
    return this.query(user, transcription);
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const aiService = new AIService();
