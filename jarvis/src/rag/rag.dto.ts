import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class RagAskDto {
  @IsString()
  question!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  topK?: number;
}
