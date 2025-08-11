/**
 * AWS Provider Configuration
 */

import { z } from 'zod';

/**
 * AWS credentials configuration
 */
export const AwsCredentialsSchema = z.object({
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  sessionToken: z.string().optional(),
  profile: z.string().optional(),
  roleArn: z.string().optional(),
  roleSessionName: z.string().optional()
});

/**
 * AWS KMS configuration
 */
export const AwsKmsConfigSchema = z.object({
  region: z.string().default('us-east-1'),
  endpoint: z.string().optional(),
  keyPolicy: z.record(z.any()).optional(),
  defaultKeySpec: z.enum(['SYMMETRIC_DEFAULT', 'RSA_2048', 'ECC_NIST_P256']).default('SYMMETRIC_DEFAULT'),
  maxRetries: z.number().min(0).default(3),
  requestTimeout: z.number().positive().default(30000) // 30 seconds
});

/**
 * AWS S3 configuration
 */
export const AwsS3ConfigSchema = z.object({
  region: z.string().default('us-east-1'),
  endpoint: z.string().optional(),
  bucket: z.string().min(1),
  forcePathStyle: z.boolean().default(false),
  accelerate: z.boolean().default(false),
  maxRetries: z.number().min(0).default(3),
  requestTimeout: z.number().positive().default(60000), // 60 seconds
  uploadTimeout: z.number().positive().default(300000), // 5 minutes
  multipartThreshold: z.number().positive().default(100 * 1024 * 1024), // 100MB
  partSize: z.number().positive().default(10 * 1024 * 1024) // 10MB
});

/**
 * AWS Secrets Manager configuration
 */
export const AwsSecretsManagerConfigSchema = z.object({
  region: z.string().default('us-east-1'),
  endpoint: z.string().optional(),
  maxRetries: z.number().min(0).default(3),
  requestTimeout: z.number().positive().default(30000) // 30 seconds
});

/**
 * Complete AWS provider configuration
 */
export const AwsProviderConfigSchema = z.object({
  credentials: AwsCredentialsSchema.optional(),
  kms: AwsKmsConfigSchema.default({}),
  s3: AwsS3ConfigSchema.optional(), // Required if using blob storage
  secretsManager: AwsSecretsManagerConfigSchema.default({})
});

export type AwsCredentials = z.infer<typeof AwsCredentialsSchema>;
export type AwsKmsConfig = z.infer<typeof AwsKmsConfigSchema>;
export type AwsS3Config = z.infer<typeof AwsS3ConfigSchema>;
export type AwsSecretsManagerConfig = z.infer<typeof AwsSecretsManagerConfigSchema>;
export type AwsProviderConfig = z.infer<typeof AwsProviderConfigSchema>;

/**
 * Default configuration
 */
export const defaultAwsConfig: AwsProviderConfig = {
  kms: {
    region: 'us-east-1',
    defaultKeySpec: 'SYMMETRIC_DEFAULT',
    maxRetries: 3,
    requestTimeout: 30000
  },
  secretsManager: {
    region: 'us-east-1',
    maxRetries: 3,
    requestTimeout: 30000
  }
};