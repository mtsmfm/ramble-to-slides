/** Shared domain types for the whole app. */

/** One transcribed utterance. t0/t1 are seconds since recording start. */
export interface Segment {
  t0: number;
  t1: number;
  text: string;
  /**
   * The agent's cleaned-up version of `text` (see the correct_segments tool).
   * Absent while the segment has not been corrected; `text` is never overwritten.
   */
  corrected?: string;
}

/** How a question ended up being answered. */
export type AnswerSource = "spoken" | "typed" | "skipped";

/** A question the agent showed to the user (text === "" means an unprompted note the user typed). */
export interface Question {
  id: string;
  /** Seconds since recording start when the question was shown. */
  t: number;
  text: string;
  answer: string | null;
  source: AnswerSource | null;
  /** Seconds since recording start when it was answered. */
  answeredT: number | null;
}

export type ProjectEventType =
  | "started"
  | "question_shown"
  | "answered"
  | "ask_now"
  | "pause"
  | "ended"
  | "outline_set"
  | "slides_set"
  | "glossary_added"
  | "resumed"
  | "timer_started"
  | "timer_stopped"
  | "history_restored"
  | "language_set"
  | "asr_model_set";

/** One line of events.jsonl. */
export interface ProjectEvent {
  /** Wall clock, ISO 8601. */
  at: string;
  /** Seconds since recording start. */
  t: number;
  type: ProjectEventType;
  detail?: Record<string, unknown>;
}

export type AgentEventName =
  | "ask_now"
  | "answered"
  | "pause"
  | "ended"
  | "timeout"
  | "superseded";

/** The bare event handed to wait_for_event before the transcript snapshot is attached. */
export interface AgentEvent {
  event: AgentEventName;
  /** "answered" only: what the user typed. */
  answer?: string;
  /** "answered" only. */
  question_id?: string;
  /** "answered" only. */
  source?: AnswerSource;
  /** "pause" only: seconds of silence that triggered it. */
  silence_s?: number;
}

/** What wait_for_event resolves with. */
export interface AgentEventResult extends AgentEvent {
  new_segments: Segment[];
  total_segments: number;
  recording: boolean;
  ended: boolean;
  pending_question: string | null;
  pending_question_id: string | null;
  elapsed_s: number;
}

/** Every tool can fail this way. */
export interface ToolError {
  error: string;
}

export function isToolError(v: unknown): v is ToolError {
  return typeof v === "object" && v !== null && typeof (v as ToolError).error === "string";
}
