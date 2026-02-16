export interface IngestResponse {
  message: string;
  chunks?: number;
}

export interface RagSource {
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface RagResponse {
  answer: string;
  sources: RagSource[];
}

export interface LlmResponse {
  answer: string;
}

export interface SttResponse {
  text: string;
}
