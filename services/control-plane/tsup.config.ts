import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  minify: false,
  external: [
    '@prisma/client',
    'fastify',
    'pino',
    'redis',
    'bullmq',
    'jsonwebtoken',
    'bcrypt'
  ]
});