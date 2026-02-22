import { Injectable, Logger } from '@nestjs/common';
import { MemoryService } from '../../memory/memory.service';
import { RagService } from '../../rag/rag.service';
import { LlmService } from '../../llm/llm.service';
import { AgentAction, AgentContext } from '../agent.types';
import { IntentResult, IntentType } from '../intent/intent.types';

export interface EngineResult {
  answer: string;
  sources?: string[];
  actions?: AgentAction[];
}

@Injectable()
export class IntentRouterService {
  private readonly logger = new Logger(IntentRouterService.name);

  constructor(
    private readonly memoryService: MemoryService,
    private readonly ragService: RagService,
    private readonly llmService: LlmService,
  ) {}

  async route(
    intent: IntentResult,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _context: AgentContext,
  ): Promise<EngineResult> {
    this.logger.debug(`Routing intent: ${intent.primary}`);

    switch (intent.primary) {
      case IntentType.MEMORY_ADD:
        return this.handleMemoryAdd(intent);

      case IntentType.MEMORY_QUERY:
        return this.handleMemoryQuery(intent);

      case IntentType.RAG_QUESTION:
        return this.handleRagQuestion(intent);

      case IntentType.GENERAL_QUESTION:
      case IntentType.CHITCHAT:
        return this.handleGeneralQuestion(intent);

      // Phase 4 intents — graceful "not yet implemented" responses
      case IntentType.SCHEDULE_EVENT:
      case IntentType.QUERY_SCHEDULE:
      case IntentType.CREATE_TASK:
      case IntentType.QUERY_TASKS:
      case IntentType.COMPLETE_TASK:
      case IntentType.ADD_GOAL:
      case IntentType.QUERY_GOALS:
      case IntentType.EXECUTE_ACTION:
      case IntentType.MEMORY_UPDATE:
      case IntentType.MEMORY_DELETE:
        return {
          answer: "Cette fonctionnalité n'est pas encore disponible.",
        };

      default:
        return this.handleUnknown();
    }
  }

  private async handleMemoryAdd(intent: IntentResult): Promise<EngineResult> {
    const result = await this.memoryService.add(
      intent.extractedContent,
      'agent',
      'memory',
    );
    return {
      answer: result.eventDate
        ? `C'est noté. J'ai détecté une date : ${result.expression}.`
        : "C'est noté.",
    };
  }

  private async handleMemoryQuery(intent: IntentResult): Promise<EngineResult> {
    const result = await this.memoryService.query(intent.extractedContent);
    return {
      answer: result.answer,
      sources: result.sources,
    };
  }

  private async handleRagQuestion(intent: IntentResult): Promise<EngineResult> {
    const result = await this.ragService.ask(intent.extractedContent);
    return {
      answer: result.answer,
      sources: result.sources,
    };
  }

  private async handleGeneralQuestion(
    intent: IntentResult,
  ): Promise<EngineResult> {
    const answer = await this.llmService.ask(intent.extractedContent);
    return { answer };
  }

  private handleUnknown(): EngineResult {
    return {
      answer:
        "Je n'ai pas bien compris votre demande. Pouvez-vous reformuler ?",
    };
  }
}
