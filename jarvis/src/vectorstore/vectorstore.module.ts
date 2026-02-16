import { Module } from '@nestjs/common';
import { VectorstoreService } from './vectorstore.service';

@Module({
  providers: [VectorstoreService],
  exports: [VectorstoreService],
})
export class VectorstoreModule {}
