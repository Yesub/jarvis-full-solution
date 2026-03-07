import { Module } from '@nestjs/common';
import { OllamaModule } from '../ollama/ollama.module';
import { VectorstoreModule } from '../vectorstore/vectorstore.module';
import { TemporalModule } from '../temporal/temporal.module';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';
import { TokenizerService } from './tokenizer.service';

@Module({
  imports: [OllamaModule, VectorstoreModule, TemporalModule],
  providers: [RagService, TokenizerService],
  controllers: [RagController],
  exports: [RagService],
})
export class RagModule {}
