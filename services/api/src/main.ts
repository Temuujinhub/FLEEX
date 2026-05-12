import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { WsAdapter } from '@nestjs/platform-ws';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    cors: false,
  });
  const config = app.get(ConfigService);
  const port = Number(config.get('API_PORT') ?? 3000);
  const host = config.get<string>('API_HOST') ?? '0.0.0.0';
  const corsOrigin = config.get<string>('CORS_ORIGIN') ?? '*';

  app.setGlobalPrefix('api', { exclude: ['health', '/'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ extended: true, limit: '5mb' }));

  app.enableCors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
  });

  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  await app.listen(port, host);
  Logger.log(`Fleex API listening on http://${host}:${port}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
