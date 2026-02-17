import { Body, Controller, Post } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryAddDto, MemoryQueryDto, MemorySearchDto } from './memory.dto';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  @Post('add')
  async add(@Body() dto: MemoryAddDto) {
    return this.memory.add(dto.text, dto.source, dto.contextType);
  }

  @Post('search')
  async search(@Body() dto: MemorySearchDto) {
    return this.memory.search(dto.query, dto.topK, dto.dateFilter);
  }

  @Post('query')
  async query(@Body() dto: MemoryQueryDto) {
    return this.memory.query(dto.query, dto.topK);
  }
}
