import { Module } from '@nestjs/common';
import { OllamaModule } from '../ollama/ollama.module';
import { VectorstoreModule } from '../vectorstore/vectorstore.module';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';

@Module({
  imports: [OllamaModule, VectorstoreModule],
  providers: [RagService],
  controllers: [RagController],
})
export class RagModule {}
