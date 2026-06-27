import OpenAI from 'openai';
import { getOpenAIClient, resolveChatModel } from './aiProviderConfig';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClassificationResult {
  action: string; // 'none' if no action detected
  params?: Record<string, unknown>;
  confidence: number; // 0.0 - 1.0
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.6;
const TIMEOUT_MS = 15000;

const CLASSIFICATION_SYSTEM_PROMPT = `You are an intent classifier for a school management system called SAMS.
Given a user message and a list of available actions, determine if the message is requesting one of the actions.

Respond with JSON only (no markdown):
- If the message matches an action: {"action": "<action_name>", "params": {...extracted params...}, "confidence": 0.0-1.0}
- If no action matches: {"action": "none", "confidence": 1.0}

Rules:
- Only classify as an action if confidence >= 0.6
- Extract relevant parameters from the message
- If ambiguous between multiple actions, pick the highest confidence one
- Questions asking "how many" teachers, students, or classes in the user's department are action requests (e.g. view_department_stats, get_school_stats), not generic informational chat — classify them when a matching stats action exists
- "Send message to class", "notify students", "notify department", "notify school" are action requests when a matching send_* action exists for the role
- "Remind me at class time", "set a reminder", or "will you remind me" for students map to explain_reminders (not a generic refusal)
- "Export report", "download PDF", "get attendance report", "generate report" are action requests when export_* actions exist
- "Generate timetable", "create timetable", "auto generate timetable" are action requests when generate_timetable exists
- Do not classify general knowledge or policy questions as actions`;

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Classify a user message against a list of candidate actions using an LLM.
 * Returns the classified action and extracted parameters, or null on error/timeout.
 *
 * - 5-second timeout for LLM calls
 * - Confidence threshold of 0.7
 * - Graceful degradation: returns null if no API key or on any error
 */
export async function classifyIntent(
  message: string,
  candidates: Array<{ action: string; description: string }>,
): Promise<ClassificationResult | null> {
  let client: OpenAI;
  try {
    client = getOpenAIClient();
  } catch {
    return null; // No API key — graceful degradation
  }

  if (candidates.length === 0) return null;

  const userPrompt = `Message: "${message}"

Available actions:
${candidates.map((c) => `- ${c.action}: ${c.description}`).join('\n')}

Classify this message.`;

  try {
    // Create an AbortController for the 5-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await client.chat.completions.create(
      {
        model: resolveChatModel(),
        messages: [
          { role: 'system', content: CLASSIFICATION_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 200,
      },
      { signal: controller.signal },
    );

    clearTimeout(timeoutId);

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    // Parse JSON from the response (handle markdown code blocks)
    const jsonStr = content.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    // Apply confidence threshold
    if (!parsed.action || parsed.confidence < CONFIDENCE_THRESHOLD) {
      return { action: 'none', confidence: parsed.confidence ?? 0 };
    }

    return {
      action: parsed.action,
      params: parsed.params,
      confidence: parsed.confidence,
    };
  } catch (err) {
    // LLM failure or timeout — treat as no action detected
    console.error('[LLM Classifier] Error:', (err as Error).message);
    return null;
  }
}
