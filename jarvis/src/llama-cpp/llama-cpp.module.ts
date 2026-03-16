import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlamaCppService } from './llama-cpp.service';

@Module({
  imports: [ConfigModule],
  providers: [LlamaCppService],
  exports: [LlamaCppService],
})
export class LlamaCppModule {}
