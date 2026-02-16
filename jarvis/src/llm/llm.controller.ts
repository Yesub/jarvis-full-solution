import { Body, Controller, Post, Res } from '@nestjs/common';
import * as express from 'express';
import { LlmService } from './llm.service';
import { LlmAskDto } from './llm.dto';

@Controller('llm')
export class LlmController {
  constructor(private readonly llm: LlmService) {}

  @Post('ask')
  async ask(@Body() dto: LlmAskDto): Promise<{ answer: string }> {
    return { answer: await this.llm.ask(dto.prompt) };
  }

  @Post('ask/stream')
  async askStream(
    @Body() dto: LlmAskDto,
    @Res() res: express.Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      for await (const token of this.llm.askStream(dto.prompt)) {
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    } catch {
      res.write(`data: ${JSON.stringify({ error: 'Generation failed' })}\n\n`);
    } finally {
      res.end();
    }
  }
}
