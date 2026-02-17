import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health/health.controller';
import { OllamaModule } from './ollama/ollama.module';
import { VectorstoreModule } from './vectorstore/vectorstore.module';
import { RagModule } from './rag/rag.module';
import { LlmModule } from './llm/llm.module';
import { SttModule } from './stt/stt.module';
import { MemoryModule } from './memory/memory.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    OllamaModule,
    VectorstoreModule,
    RagModule,
    LlmModule,
    SttModule,
    MemoryModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
