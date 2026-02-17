export type MemoryPayload = {
  text: string;
  source: string;
  addedAt: string; // ISO 8601 — when stored
  contextType: string; // 'memory' | 'summary' | 'mood' | custom
  eventDate?: string; // ISO 8601 — event date from TemporalService
  importance?: number; // 0.0–1.0, reserved for Phase 3.1
  accessCount?: number; // reserved for Phase 3.1
};
