import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MemoryAddDto {
  @IsString()
  @MinLength(1)
  text!: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  contextType?: string;
}

export class DateFilterDto {
  @IsIn(['eventDate', 'addedAt'])
  field!: 'eventDate' | 'addedAt';

  @IsOptional()
  @IsISO8601()
  gte?: string;

  @IsOptional()
  @IsISO8601()
  lte?: string;
}

export class MemorySearchDto {
  @IsString()
  @MinLength(1)
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  topK?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => DateFilterDto)
  dateFilter?: DateFilterDto;
}

export class MemoryQueryDto {
  @IsString()
  @MinLength(1)
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  topK?: number;
}
