export const JARVIS_EVENTS = {
  MEMORY_ADDED: 'memory.added',
  MEMORY_QUERIED: 'memory.queried',
  MEMORY_SEARCHED: 'memory.searched',
  INTENT_CLASSIFIED: 'intent.classified',
  ACTION_TRIGGERED: 'action.triggered',
  REMINDER_DUE: 'reminder.due',
  FEEDBACK_RECEIVED: 'feedback.received',
} as const;

export type JarvisEventName =
  (typeof JARVIS_EVENTS)[keyof typeof JARVIS_EVENTS];

// ── Memory events ─────────────────────────────────────────────────────────────

export interface MemoryAddedEvent {
  memoryId: string;
  text: string;
  source: string;
  eventDate?: string;
}

export interface MemoryQueriedEvent {
  question: string;
  answer: string;
  sourceIds: string[];
  topK: number;
}

export interface MemorySearchedEvent {
  query: string;
  resultCount: number;
  topK: number;
}

// ── Future events (Phase 2–5) ─────────────────────────────────────────────────

export interface IntentClassifiedEvent {
  rawText: string;
  intent: string; // IntentType value (e.g. 'memory_add', 'memory_query', ...)
  confidence: number;
  sessionId?: string;
}

export interface ActionTriggeredEvent {
  action: string;
  params: Record<string, unknown>;
  triggeredAt: string;
}

export interface ReminderDueEvent {
  memoryId: string;
  text: string;
  dueAt: string;
}

export interface FeedbackReceivedEvent {
  sessionId?: string;
  rating: number;
  comment?: string;
}
