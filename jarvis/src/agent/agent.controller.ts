import { Body, Controller, Post } from '@nestjs/common';
import { AgentService } from './agent.service';
import type { AgentProcessDto, AgentResponse } from './agent.types';
import type { IntentResult } from './intent/intent.types';

@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('process')
  async process(@Body() dto: AgentProcessDto): Promise<AgentResponse> {
    return this.agentService.process(dto);
  }

  @Post('classify')
  async classify(@Body() dto: { text: string }): Promise<IntentResult> {
    return this.agentService.classify(dto.text);
  }
}
