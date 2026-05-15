import OpenAI from 'openai';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClassificationResult {
  action: string; // 'none' if no action detected
  params?: Record<string, unknown>;
  confidence: number; // 0.0 - 1.0
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.7;
const TIMEOUT_MS = 5000;

const CLASSIFICATION_SYSTEM_PROMPT = `You are an intent classifier for a school management system.
Given a user message and a list of available actions, determine if the message is requesting one of the actions.

Respond with JSON only:
- If the message matches an action: {"action": "<action_name>", "params": {...extracted params...}, "confidence": 0.0-1.0}
- If no action matches: {"action": "none", "confidence": 1.0}

Rules:
- Only classify as an action if confidence >= 0.7
- Extract relevant parameters from the message
- If ambiguous between multiple actions, pick the highest confidence one
- Never classify informational questions as actions`;

// ─── LLM Client ───────────────────────────────────────────────────────────────

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseURL = process.env.OPENAI_BASE_URL || 'https://api.groq.com/openai/v1';
  return new OpenAI({ apiKey, baseURL });
}

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
  const client = getClient();
  if (!client) return null; // No API key — graceful degradation

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
        model: process.env.OPENAI_MODEL ?? 'llama3-70b-8192',
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
