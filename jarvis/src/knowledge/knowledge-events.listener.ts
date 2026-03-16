import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JARVIS_EVENTS, type MemoryAddedEvent } from '../events/jarvis.events';
import { EntityExtractorService } from './entity-extractor.service';
import { KnowledgeGraphService } from './knowledge-graph.service';

@Injectable()
export class KnowledgeEventsListener {
  private readonly logger = new Logger(KnowledgeEventsListener.name);

  constructor(
    private readonly extractor: EntityExtractorService,
    private readonly graph: KnowledgeGraphService,
  ) {}

  @OnEvent(JARVIS_EVENTS.MEMORY_ADDED)
  onMemoryAdded(event: MemoryAddedEvent): void {
    this.handleAsync(event).catch((err) =>
      this.logger.error(`[knowledge.memory.added] Erreur non gérée: ${err}`),
    );
  }

  private async handleAsync(event: MemoryAddedEvent): Promise<void> {
    if (!this.graph.isReady) return;

    this.logger.debug(
      `[knowledge.memory.added] Extraction entités pour memoryId=${event.memoryId}`,
    );

    const result = await this.extractor.extract(event.text, event.memoryId);

    if (result.entities.length === 0) {
      this.logger.debug(
        `[knowledge.memory.added] Aucune entité trouvée pour memoryId=${event.memoryId}`,
      );
      return;
    }

    await this.graph.upsertEntities(result.entities, event.memoryId);

    for (const rel of result.relations) {
      await this.graph.upsertRelation(
        rel.from,
        rel.to,
        rel.relation,
        rel.context,
        event.memoryId,
      );
    }

    this.logger.log(
      `[knowledge.memory.added] memoryId=${event.memoryId} → ${result.entities.length} entités, ${result.relations.length} relations`,
    );
  }
}
