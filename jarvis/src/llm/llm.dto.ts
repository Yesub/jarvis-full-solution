import { IsString, MinLength } from 'class-validator';

export class LlmAskDto {
  @IsString()
  @MinLength(1)
  prompt!: string;
}
