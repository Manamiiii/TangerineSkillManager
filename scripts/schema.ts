import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { configSchema, defaultConfig } from '../src/shared/config';
await mkdir('config', { recursive: true });
await writeFile('config/schema.json', JSON.stringify(z.toJSONSchema(configSchema), null, 2) + '\n');
await writeFile('config/example.json', JSON.stringify(defaultConfig(), null, 2) + '\n');
