import { buildApp } from './app';
import { loadConfig } from './config/env';

async function main(): Promise<void> {
  const config = loadConfig();
  const { app } = buildApp(config);

  try {
    await app.listen({
      port: config.PORT,
      host: '0.0.0.0',
    });
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

void main();
