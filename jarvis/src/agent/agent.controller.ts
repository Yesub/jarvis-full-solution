import { Body, Controller, Post, Res } from '@nestjs/common';
import * as express from 'express';
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

  @Post('process/stream')
  async processStream(
    @Body() dto: AgentProcessDto,
    @Res() res: express.Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const result = await this.agentService.process(dto);

      res.write(
        `event: metadata\ndata: ${JSON.stringify({
          sessionId: result.sessionId,
          intent: result.intent,
          confidence: result.confidence,
          sources: result.sources,
        })}\n\n`,
      );

      // Stream the answer word by word for a natural feel
      const words = result.answer.split(' ');
      for (const word of words) {
        res.write(`data: ${JSON.stringify({ token: word + ' ' })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    } catch {
      res.write(
        `data: ${JSON.stringify({ error: 'Agent processing failed' })}\n\n`,
      );
    } finally {
      res.end();
    }
  }

  @Post('classify')
  async classify(@Body() dto: { text: string }): Promise<IntentResult> {
    return this.agentService.classify(dto.text);
  }
}
