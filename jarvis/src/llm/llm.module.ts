import { Module } from '@nestjs/common';
import { OllamaModule } from '../ollama/ollama.module';
import { LlmService } from './llm.service';
import { LlmController } from './llm.controller';

@Module({
  imports: [OllamaModule],
  providers: [LlmService],
  controllers: [LlmController],
  exports: [LlmService],
})
export class LlmModule {}
