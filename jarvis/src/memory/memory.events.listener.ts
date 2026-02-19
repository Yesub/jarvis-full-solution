import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  JARVIS_EVENTS,
  type MemoryAddedEvent,
  type MemoryQueriedEvent,
  type MemorySearchedEvent,
} from '../events/jarvis.events';

// TODO: Remove this listener once event bus is verified working.
@Injectable()
export class MemoryEventsListener {
  private readonly logger = new Logger('MemoryEventsListener');

  @OnEvent(JARVIS_EVENTS.MEMORY_ADDED)
  onMemoryAdded(event: MemoryAddedEvent) {
    this.logger.log(
      `[memory.added] id=${event.memoryId} source="${event.source}"${event.eventDate ? ` eventDate=${event.eventDate}` : ''} text="${event.text.slice(0, 60)}${event.text.length > 60 ? '…' : ''}"`,
    );
  }

  @OnEvent(JARVIS_EVENTS.MEMORY_SEARCHED)
  onMemorySearched(event: MemorySearchedEvent) {
    this.logger.log(
      `[memory.searched] query="${event.query.slice(0, 60)}${event.query.length > 60 ? '…' : ''}" results=${event.resultCount}/${event.topK}`,
    );
  }

  @OnEvent(JARVIS_EVENTS.MEMORY_QUERIED)
  onMemoryQueried(event: MemoryQueriedEvent) {
    this.logger.log(
      `[memory.queried] question="${event.question.slice(0, 60)}${event.question.length > 60 ? '…' : ''}" topK=${event.topK} sources=[${event.sourceIds.join(', ')}]`,
    );
  }
}
