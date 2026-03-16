import { Module } from '@nestjs/common';
import { LlamaCppModule } from '../llama-cpp/llama-cpp.module';
import { LlmService } from './llm.service';
import { LlmController } from './llm.controller';

@Module({
  imports: [LlamaCppModule],
  providers: [LlmService],
  controllers: [LlmController],
  exports: [LlmService],
})
export class LlmModule {}
