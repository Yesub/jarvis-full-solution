import { Module } from '@nestjs/common';
import { LlamaCppModule } from '../llama-cpp/llama-cpp.module';
import { KnowledgeGraphService } from './knowledge-graph.service';
import { EntityExtractorService } from './entity-extractor.service';
import { KnowledgeEventsListener } from './knowledge-events.listener';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';

@Module({
  imports: [LlamaCppModule],
  providers: [
    KnowledgeGraphService,
    EntityExtractorService,
    KnowledgeEventsListener,
    KnowledgeService,
  ],
  controllers: [KnowledgeController],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
