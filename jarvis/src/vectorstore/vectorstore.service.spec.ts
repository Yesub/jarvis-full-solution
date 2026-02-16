import { Test, TestingModule } from '@nestjs/testing';
import { VectorstoreService } from './vectorstore.service';

describe('VectorstoreService', () => {
  let service: VectorstoreService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VectorstoreService],
    }).compile();

    service = module.get<VectorstoreService>(VectorstoreService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
