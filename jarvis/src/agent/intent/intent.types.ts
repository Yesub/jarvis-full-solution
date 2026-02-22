export enum IntentType {
  // Memory
  MEMORY_ADD = 'memory_add',
  MEMORY_QUERY = 'memory_query',
  MEMORY_UPDATE = 'memory_update',
  MEMORY_DELETE = 'memory_delete',

  // Timeline / Scheduling (Phase 4)
  SCHEDULE_EVENT = 'schedule_event',
  QUERY_SCHEDULE = 'query_schedule',

  // Tasks (Phase 4)
  CREATE_TASK = 'create_task',
  QUERY_TASKS = 'query_tasks',
  COMPLETE_TASK = 'complete_task',

  // Knowledge
  RAG_QUESTION = 'rag_question',
  GENERAL_QUESTION = 'general_question',

  // Goals (Phase 4)
  ADD_GOAL = 'add_goal',
  QUERY_GOALS = 'query_goals',

  // Actions (Phase 4)
  EXECUTE_ACTION = 'execute_action',

  // Meta
  CORRECTION = 'correction',
  CONFIRMATION = 'confirmation',
  REJECTION = 'rejection',
  CHITCHAT = 'chitchat',
  UNKNOWN = 'unknown',
}

export interface ExtractedEntities {
  person?: string;
  location?: string;
  time?: string;
  duration?: string;
  object?: string;
  task?: string;
  frequency?: string;
}

export interface IntentResult {
  primary: IntentType;
  confidence: number; // 0.0 - 1.0
  secondary?: IntentType;
  extractedContent: string;
  entities: ExtractedEntities;
  temporal?: {
    type: 'datetime' | 'interval' | 'recurrence';
    value: string;
  };
  priority: 'high' | 'normal' | 'low';
}
