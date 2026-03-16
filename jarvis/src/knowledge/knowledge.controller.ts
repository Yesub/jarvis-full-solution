import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { KnowledgeService } from './knowledge.service';
import type { EntityResponse, KnowledgeEntity } from './knowledge.types';

class KnowledgeQueryDto {
  @IsString()
  @MinLength(1)
  question!: string;
}

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get('entity/:name')
  async getEntity(@Param('name') name: string): Promise<EntityResponse> {
    const result = await this.knowledge.getEntity(name);
    if (!result.found) {
      throw new NotFoundException(
        `Entité "${name}" introuvable dans le graphe de connaissance.`,
      );
    }
    return result;
  }

  @Get('search')
  async search(@Query('q') q: string): Promise<KnowledgeEntity[]> {
    if (!q) return [];
    return this.knowledge.searchEntities(q);
  }

  @Post('query')
  async query(
    @Body() dto: KnowledgeQueryDto,
  ): Promise<{ answer: string; cypher?: string }> {
    return this.knowledge.queryNaturalLanguage(dto.question);
  }
}
