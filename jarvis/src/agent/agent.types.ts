export interface AgentContext {
  sessionId: string;
  history: ConversationMessage[];
  activeIntent?: string;
  pendingConfirmation?: PendingConfirmation;
  temporalContext?: string;
  identityContext?: IdentityProfile;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  intent?: string;
  confidence?: number;
}

export interface PendingConfirmation {
  action: string;
  params: Record<string, unknown>;
  expiresAt: string; // ISO 8601
}

export interface IdentityProfile {
  name: string;
  role?: string;
  currentProjects?: string[];
  priorities?: string[];
  preferences?: Record<string, string>;
}

export interface AgentProcessDto {
  sessionId?: string; // auto-generated if not provided
  text: string;
  source?: 'voice' | 'ui' | 'api';
}

export interface AgentResponse {
  sessionId: string;
  intent: string;
  confidence: number;
  answer: string;
  sources?: Array<{ text: string; score: number }>;
  actions?: AgentAction[];
  hallucinationWarning?: string;
}

export interface AgentAction {
  type: string;
  description: string;
  status: 'executed' | 'pending_confirmation' | 'failed';
}
