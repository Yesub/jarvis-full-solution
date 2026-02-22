import { Module } from '@nestjs/common';
import { OllamaModule } from '../ollama/ollama.module';
import { MemoryModule } from '../memory/memory.module';
import { RagModule } from '../rag/rag.module';
import { LlmModule } from '../llm/llm.module';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { IntentEngine } from './intent/intent.engine';
import { IntentRouterService } from './router/intent-router.service';
import { AgentContextManager } from './context/agent-context.manager';

@Module({
  imports: [OllamaModule, MemoryModule, RagModule, LlmModule],
  controllers: [AgentController],
  providers: [AgentService, IntentEngine, IntentRouterService, AgentContextManager],
  exports: [AgentService],
})
export class AgentModule {}
