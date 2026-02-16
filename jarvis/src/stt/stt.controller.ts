import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { SttService } from './stt.service';

@Controller('stt')
export class SttController {
  constructor(private readonly stt: SttService) {}

  @Post('transcribe')
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: diskStorage({
        destination: './uploads',
        filename: (_req, _file, cb) => cb(null, `${Date.now()}-audio.webm`),
      }),
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  async transcribe(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ text: string }> {
    if (!file) throw new BadRequestException('Aucun fichier audio fourni');
    return this.stt.transcribe(file.path);
  }
}
