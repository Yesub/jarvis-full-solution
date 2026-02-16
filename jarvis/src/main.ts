import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { LoggingInterceptor } from './common/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') ?? false,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Jarvis RAG API')
    .setDescription(
      'API de Retrieval-Augmented Generation avec Ollama et Qdrant',
    )
    .setVersion('1.0')
    .build();
  SwaggerModule.setup(
    'api',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
