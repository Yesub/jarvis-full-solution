import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as express from 'express';
import { diskStorage } from 'multer';
import { extname } from 'node:path';
import { RagService } from './rag.service';
import { RagAskDto } from './rag.dto';

@Controller('rag')
export class RagController {
  constructor(private readonly rag: RagService) {}

  @Post('ingest')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) =>
          cb(null, `${Date.now()}-${file.originalname}`),
      }),
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const allowed = ['.pdf', '.txt', '.md'];
        const ext = extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(`Type de fichier non autorisé : ${ext}`),
            false,
          );
        }
      },
    }),
  )
  async ingest(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Aucun fichier fourni');
    return this.rag.ingestFile(file.path, file.originalname);
  }

  @Post('ask')
  async ask(@Body() dto: RagAskDto) {
    return this.rag.ask(dto.question, dto.topK);
  }

  @Post('ask/stream')
  async askStream(
    @Body() dto: RagAskDto,
    @Res() res: express.Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const { sources, topK, tokenStream } = await this.rag.askStream(
        dto.question,
        dto.topK,
      );

      res.write(
        `event: metadata\ndata: ${JSON.stringify({ sources, topK })}\n\n`,
      );

      for await (const token of tokenStream) {
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
