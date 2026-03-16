import { Module } from '@nestjs/common';
import { LlamaCppModule } from '../llama-cpp/llama-cpp.module';
import { VectorstoreModule } from '../vectorstore/vectorstore.module';
import { TemporalModule } from '../temporal/temporal.module';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';
import { MemoryEventsListener } from './memory.events.listener';
import { MemoryScoringService } from './memory-scoring.service';

@Module({
  imports: [LlamaCppModule, VectorstoreModule, TemporalModule],
  providers: [MemoryService, MemoryEventsListener, MemoryScoringService],
  controllers: [MemoryController],
  exports: [MemoryService],
})
export class MemoryModule {}
