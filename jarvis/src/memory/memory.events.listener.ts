import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  JARVIS_EVENTS,
  type MemoryAddedEvent,
  type MemoryQueriedEvent,
  type MemorySearchedEvent,
} from '../events/jarvis.events';
import { VectorstoreService } from '../vectorstore/vectorstore.service';
import { MemoryScoringService } from './memory-scoring.service';
import type { MemoryPayload } from './memory.types';

@Injectable()
export class MemoryEventsListener {
  private readonly logger = new Logger('MemoryEventsListener');

  constructor(
    private readonly vs: VectorstoreService,
    private readonly scoring: MemoryScoringService,
  ) {}

  @OnEvent(JARVIS_EVENTS.MEMORY_ADDED)
  onMemoryAdded(event: MemoryAddedEvent) {
    this.logger.log(
      `[memory.added] id=${event.memoryId} source="${event.source}"${event.eventDate ? ` eventDate=${event.eventDate}` : ''} text="${event.text.slice(0, 60)}${event.text.length > 60 ? '…' : ''}"`,
    );
  }

  @OnEvent(JARVIS_EVENTS.MEMORY_SEARCHED)
  async onMemorySearched(event: MemorySearchedEvent): Promise<void> {
    this.logger.log(
      `[memory.searched] query="${event.query.slice(0, 60)}${event.query.length > 60 ? '…' : ''}" results=${event.resultCount}/${event.topK}`,
    );

    if (event.resultIds.length === 0) return;

    try {
      const points = await this.vs.retrieveMemoryPoints(event.resultIds);

      for (const point of points) {
        const p = point.payload as MemoryPayload | null | undefined;
        if (!p) continue;

        const newCount = (p.accessCount ?? 0) + 1;
        const newImportance = this.scoring.recomputeImportance(
          p.addedAt,
          newCount,
          p.text,
          p.eventDate,
        );

        await this.vs.updateMemoryPayload(String(point.id), {
          accessCount: newCount,
          importance: newImportance,
        });
      }
    } catch (err) {
      this.logger.warn(`[memory.searched] Failed to update accessCount: ${err}`);
    }
  }

  @OnEvent(JARVIS_EVENTS.MEMORY_QUERIED)
  onMemoryQueried(event: MemoryQueriedEvent) {
    this.logger.log(
      `[memory.queried] question="${event.question.slice(0, 60)}${event.question.length > 60 ? '…' : ''}" topK=${event.topK} sources=[${event.sourceIds.join(', ')}]`,
    );
  }
}
