import { Module } from '@nestjs/common';
import { OllamaModule } from '../ollama/ollama.module';
import { VectorstoreModule } from '../vectorstore/vectorstore.module';
import { TemporalModule } from '../temporal/temporal.module';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';
import { MemoryEventsListener } from './memory.events.listener';

@Module({
  imports: [OllamaModule, VectorstoreModule, TemporalModule],
  providers: [MemoryService, MemoryEventsListener],
  controllers: [MemoryController],
  exports: [MemoryService],
})
export class MemoryModule {}
