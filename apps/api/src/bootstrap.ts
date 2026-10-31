import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

/** Shared app configuration used by main.ts and the integration tests. */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api');
  // Behind nginx / a load balancer, take the client IP from X-Forwarded-For (rate limits, audit log).
  if (process.env.TRUST_PROXY) (app.getHttpAdapter().getInstance() as { set(k: string, v: unknown): void }).set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
  app.use(helmet());
  app.enableCors({ origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  return app;
}
