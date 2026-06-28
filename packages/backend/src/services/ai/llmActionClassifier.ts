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

CRITICAL: The user may express their request in ANY natural language. They are NOT writing commands. They talk like one person talking to another. Examples:
- "go back to timetable" = view_timetable
- "can you please read for me the only late students" = view_class_attendance or query_attendance with type=absent_today
- "open student portal" = list_my_teachers or describe_my_class or some student action
- "can you show me my schedule" = view_today_schedule
- "I want to see who's at risk" = view_risk_scores
- "let me know which students are absent today" = view_class_attendance
- "send a message to the class" = send_class_message
- "how is John doing in my class" = view_student_risk or view_class_attendance
- "please remind me about class" = explain_reminders (for students)
- "notify the department about the meeting" = send_department_notification
- "generate a registration link for a new student" = create_registration_link
- "talk to a teacher about my child" = send_message_to_teacher
- "I need to speak with a parent" = list_parent_conversations

Rules:
- Only classify as an action if confidence >= 0.6
- Understand the USER'S REAL INTENT, not just keywords. "can we go back to the timetable" means view_timetable.
- Extract relevant parameters from the message (e.g., names, subjects, class names)
- If ambiguous between multiple actions, pick the highest confidence one
- Questions asking "how many" teachers, students, or classes in the user's department are action requests (e.g. view_department_stats, get_school_stats), not generic informational chat — classify them when a matching stats action exists
- "Send message to class", "notify students", "notify department", "notify school" are action requests when a matching send_* action exists for the role
- "Remind me at class time", "set a reminder", or "will you remind me" for students map to explain_reminders (not a generic refusal)
- "Export report", "download PDF", "get attendance report", "generate report" are action requests when export_* actions exist
- "Generate timetable", "create timetable", "auto generate timetable" are action requests when generate_timetable exists
- Do not classify general knowledge or policy questions as actions
- CASUAL LANGUAGE IS THE NORM: "hey can you pull up my timetable" = view_timetable. "what's the attendance looking like" = view_class_attendance. "who teaches me" = list_my_teachers.`;

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
