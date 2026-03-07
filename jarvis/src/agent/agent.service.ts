import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import {
  AgentContext,
  AgentProcessDto,
  AgentResponse,
  PENDING_ACTIONS,
  PendingConfirmation,
} from './agent.types';
import { IntentEngine } from './intent/intent.engine';
import { IntentResult, IntentType } from './intent/intent.types';
import {
  EngineResult,
  IntentRouterService,
} from './router/intent-router.service';
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
      return await this.handleMetaIntent(intent, context, sessionId, dto.text);
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

  private async handleMetaIntent(
    intent: IntentResult,
    context: AgentContext,
    sessionId: string,
    originalText: string,
  ): Promise<AgentResponse> {
    const pending = context.pendingConfirmation;

    switch (intent.primary) {
      case IntentType.CONFIRMATION:
        if (pending) {
          // Vérifier TTL avant exécution
          if (new Date(pending.expiresAt) < new Date()) {
            this.contextManager.clearPendingConfirmation(sessionId);
            return {
              sessionId,
              intent: intent.primary,
              confidence: intent.confidence,
              answer:
                "La confirmation est arrivée trop tard, l'action a expiré. Reformulez votre demande.",
            };
          }
          this.contextManager.clearPendingConfirmation(sessionId);
          try {
            const result = await this.executePendingAction(pending, context);
            this.contextManager.addMessage(
              sessionId,
              'assistant',
              result.answer,
            );
            return {
              sessionId,
              intent: intent.primary,
              confidence: intent.confidence,
              answer: result.answer,
              sources: result.sources?.map((s) => ({ text: s, score: 1 })),
              actions: [
                ...(result.actions ?? []),
                {
                  type: pending.action,
                  description: `Confirmed and executed: ${pending.action}`,
                  status: 'executed',
                },
              ],
            };
          } catch (error) {
            this.logger.error(
              `[${sessionId}] executePendingAction failed for action "${pending.action}"`,
              error,
            );
            return {
              sessionId,
              intent: intent.primary,
              confidence: intent.confidence,
              answer:
                "J'ai essayé d'exécuter l'action confirmée mais une erreur s'est produite.",
              actions: [
                {
                  type: pending.action,
                  description: 'Execution failed after confirmation',
                  status: 'failed',
                },
              ],
            };
          }
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
          const cancelAnswer = "D'accord, j'annule.";
          this.contextManager.addMessage(sessionId, 'assistant', cancelAnswer);
          return {
            sessionId,
            intent: intent.primary,
            confidence: intent.confidence,
            answer: cancelAnswer,
            actions: [
              {
                type: pending.action,
                description: 'Rejected by user',
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

      case IntentType.CORRECTION: {
        // Loguer la correction dans l'historique
        this.contextManager.addMessage(
          sessionId,
          'user',
          originalText,
          intent.primary,
        );

        // extractedContent = ce que le LLM a extrait sans le préfixe de correction
        // Si identique au texte original (fallback regex), utiliser le texte complet
        const correctedText =
          intent.extractedContent && intent.extractedContent !== originalText
            ? intent.extractedContent
            : originalText;

        // Re-classifier le contenu corrigé
        const correctedIntent = await this.intentEngine.classify(correctedText);

        this.logger.log(
          `[${sessionId}] CORRECTION re-classified "${correctedText.slice(0, 60)}" → ${correctedIntent.primary} (${correctedIntent.confidence})`,
        );

        // Guard anti-récursion : si la re-classification est encore un meta-intent
        if (this.isMetaIntent(correctedIntent.primary)) {
          return {
            sessionId,
            intent: intent.primary,
            confidence: intent.confidence,
            answer:
              "Je n'ai pas bien compris la correction. Pouvez-vous reformuler votre demande complète ?",
          };
        }

        // Router directement (pas process() : évite la récursion et le double-emit)
        const result = await this.router.route(correctedIntent, context);
        this.contextManager.addMessage(sessionId, 'assistant', result.answer);

        return {
          sessionId,
          intent: intent.primary, // on garde CORRECTION comme intent reporté
          confidence: intent.confidence,
          answer: `Correction prise en compte : ${result.answer}`,
          sources: result.sources?.map((s) => ({ text: s, score: 1 })),
          actions: result.actions,
        };
      }

      default:
        return {
          sessionId,
          intent: intent.primary,
          confidence: intent.confidence,
          answer: "Je n'ai pas bien compris votre demande.",
        };
    }
  }

  /**
   * Exécute une action stockée en `pendingConfirmation` après confirmation de l'utilisateur.
   * Reconstruit un IntentResult minimal depuis les params stockés et délègue au routeur.
   */
  private async executePendingAction(
    pending: PendingConfirmation,
    context: AgentContext,
  ): Promise<EngineResult> {
    this.logger.log(`Executing confirmed pending action: ${pending.action}`);

    const buildIntent = (
      primary: IntentType,
      content: string,
    ): IntentResult => ({
      primary,
      confidence: 1.0,
      extractedContent: content,
      entities: {},
      priority: 'normal',
    });

    switch (pending.action) {
      case PENDING_ACTIONS.MEMORY_ADD: {
        const text =
          typeof pending.params['text'] === 'string'
            ? pending.params['text']
            : '';
        return this.router.route(
          buildIntent(IntentType.MEMORY_ADD, text),
          context,
        );
      }

      case PENDING_ACTIONS.MEMORY_QUERY: {
        const question =
          typeof pending.params['question'] === 'string'
            ? pending.params['question']
            : '';
        return this.router.route(
          buildIntent(IntentType.MEMORY_QUERY, question),
          context,
        );
      }

      case PENDING_ACTIONS.RAG_QUESTION: {
        const question =
          typeof pending.params['question'] === 'string'
            ? pending.params['question']
            : '';
        return this.router.route(
          buildIntent(IntentType.RAG_QUESTION, question),
          context,
        );
      }

      default:
        this.logger.warn(
          `executePendingAction: unknown action "${pending.action}"`,
        );
        return {
          answer: `Je ne sais pas comment exécuter l'action "${pending.action}". Elle n'est peut-être pas encore disponible.`,
        };
    }
  }
}
