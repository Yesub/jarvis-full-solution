export type RagPayload = {
  source: string;
  chunkIndex: number;
  text: string;
  addedAt?: string; // ISO 8601 — date d'ajout (pour les textes bruts)
  contextType?: string; // Type de contexte : 'document' | 'memory' | ...
  eventDate?: string; // ISO 8601 — date de l'événement décrit (si détecté)
};
