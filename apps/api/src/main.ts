import 'reflect-metadata';
import { config } from 'dotenv';
config();
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { validateEnv } from './config';

async function bootstrap() {
  validateEnv();
  const app = configureApp(await NestFactory.create(AppModule));
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.log(`QA Pilot API listening on http://localhost:${port}/api`, 'Bootstrap');
}
bootstrap();
