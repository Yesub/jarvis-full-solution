export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  intent?: string;
  confidence?: number;
  sources?: Array<{ text: string; score: number }>;
}

export interface AgentResponse {
  sessionId: string;
  intent: string;
  confidence: number;
  answer: string;
  sources?: Array<{ text: string; score: number }>;
  actions?: Array<{ type: string; description: string; status: string }>;
}
