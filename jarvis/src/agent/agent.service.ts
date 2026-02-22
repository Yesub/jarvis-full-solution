import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import {
  AgentContext,
  AgentProcessDto,
  AgentResponse,
} from './agent.types';
import { IntentEngine } from './intent/intent.engine';
import { IntentResult, IntentType } from './intent/intent.types';
import { IntentRouterService } from './router/intent-router.service';
import { AgentContextManager } from './context/agent-context.manager';
import {
  JARVIS_EVENTS,
  type IntentClassifiedEvent,
} from '../events/jarvis.events';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly intentEngine: IntentEngine,
    private readonly router: IntentRouterService,
    private readonly contextManager: AgentContextManager,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async classify(text: string): Promise<IntentResult> {
    return this.intentEngine.classify(text);
  }

  async process(dto: AgentProcessDto): Promise<AgentResponse> {
    const sessionId = dto.sessionId ?? randomUUID();
    const context = this.contextManager.getOrCreate(sessionId);

    // Step 1: Classify intent
    const intent = await this.intentEngine.classify(dto.text);

    this.logger.log(
      `[${sessionId}] "${dto.text.slice(0, 60)}" → ${intent.primary} (${intent.confidence})`,
    );

    // Step 2: Emit event
    this.eventEmitter.emit(JARVIS_EVENTS.INTENT_CLASSIFIED, {
      rawText: dto.text,
      intent: intent.primary,
      confidence: intent.confidence,
      sessionId,
    } satisfies IntentClassifiedEvent);

    // Step 3: Handle meta-intents
    if (this.isMetaIntent(intent.primary)) {
      return this.handleMetaIntent(intent, context, sessionId, dto.text);
    }

    // Step 4: Route to appropriate engine
    const result = await this.router.route(intent, context);

    // Step 5: Update context history
    this.contextManager.addMessage(sessionId, 'user', dto.text, intent.primary);
    this.contextManager.addMessage(sessionId, 'assistant', result.answer);

    return {
      sessionId,
      intent: intent.primary,
      confidence: intent.confidence,
      answer: result.answer,
      sources: result.sources?.map((s) => ({ text: s, score: 1 })),
      actions: result.actions,
    };
  }

  private isMetaIntent(intent: IntentType): boolean {
    return [
      IntentType.CORRECTION,
      IntentType.CONFIRMATION,
      IntentType.REJECTION,
    ].includes(intent);
  }

  private handleMetaIntent(
    intent: IntentResult,
    context: AgentContext,
    sessionId: string,
    originalText: string,
  ): AgentResponse {
    const pending = context.pendingConfirmation;

    switch (intent.primary) {
      case IntentType.CONFIRMATION:
        if (pending) {
          this.contextManager.clearPendingConfirmation(sessionId);
          return {
            sessionId,
            intent: intent.primary,
            confidence: intent.confidence,
            answer: "D'accord, c'est confirmé.",
            actions: [
              {
                type: pending.action,
                description: 'Confirmed',
                status: 'executed',
              },
            ],
          };
        }
        return {
          sessionId,
          intent: intent.primary,
          confidence: intent.confidence,
          answer: "Il n'y a rien en attente de confirmation.",
        };

      case IntentType.REJECTION:
        if (pending) {
          this.contextManager.clearPendingConfirmation(sessionId);
          return {
            sessionId,
            intent: intent.primary,
            confidence: intent.confidence,
            answer: "D'accord, j'annule.",
            actions: [
              {
                type: pending.action,
                description: 'Rejected',
                status: 'failed',
              },
            ],
          };
        }
        return {
          sessionId,
          intent: intent.primary,
          confidence: intent.confidence,
          answer: "Il n'y a rien à annuler.",
        };

      case IntentType.CORRECTION:
        // Re-route the corrected content
        this.contextManager.addMessage(
          sessionId,
          'user',
          originalText,
          intent.primary,
        );
        return {
          sessionId,
          intent: intent.primary,
          confidence: intent.confidence,
          answer:
            "Je prends en compte la correction. Reformulez votre demande complète si nécessaire.",
        };

      default:
        return {
          sessionId,
          intent: intent.primary,
          confidence: intent.confidence,
          answer: "Je n'ai pas bien compris votre demande.",
        };
    }
  }
}
