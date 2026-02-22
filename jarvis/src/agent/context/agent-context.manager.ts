import { Injectable } from '@nestjs/common';
import {
  AgentContext,
  ConversationMessage,
  PendingConfirmation,
} from '../agent.types';

@Injectable()
export class AgentContextManager {
  private readonly sessions = new Map<string, AgentContext>();
  private readonly TTL_MS = 30 * 60 * 1000; // 30 minutes

  getOrCreate(sessionId: string): AgentContext {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        sessionId,
        history: [],
      });
    }
    this.cleanup();
    return this.sessions.get(sessionId)!;
  }

  addMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    intent?: string,
  ): void {
    const ctx = this.getOrCreate(sessionId);
    const message: ConversationMessage = {
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(intent ? { intent } : {}),
    };
    ctx.history.push(message);
    // Keep last 20 messages
    if (ctx.history.length > 20) {
      ctx.history = ctx.history.slice(-20);
    }
  }

  setPendingConfirmation(
    sessionId: string,
    confirmation: PendingConfirmation,
  ): void {
    const ctx = this.getOrCreate(sessionId);
    ctx.pendingConfirmation = confirmation;
  }

  clearPendingConfirmation(sessionId: string): void {
    const ctx = this.getOrCreate(sessionId);
    ctx.pendingConfirmation = undefined;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, ctx] of this.sessions) {
      const lastMessage = ctx.history[ctx.history.length - 1];
      if (lastMessage) {
        const age = now - new Date(lastMessage.timestamp).getTime();
        if (age > this.TTL_MS) {
          this.sessions.delete(id);
        }
      }
    }
  }
}
