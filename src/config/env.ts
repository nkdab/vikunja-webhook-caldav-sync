import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['info', 'debug']).default('info'),
  VIKUNJA_WEBHOOK_SECRET: z.string().min(1).optional(),
  VIKUNJA_BASE_URL: z.string().url(),
  UID_DOMAIN: z.string().min(1),
  DEFAULT_DURATION_MINUTES: z.coerce.number().int().positive().default(30),
  DONE_BEHAVIOR: z.enum(['keep', 'cancel', 'delete']).default('keep'),
  DEBOUNCE_MS: z.coerce.number().int().min(0).default(0),
  CALDAV_BASE_URL: z.string().url(),
  CALDAV_USERNAME: z.string().min(1),
  CALDAV_PASSWORD: z.string().min(1),
  CALDAV_CALENDAR_NAME: z.string().min(1),
  SQLITE_PATH: z.string().default('./data/state.sqlite'),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return schema.parse(env);
}
