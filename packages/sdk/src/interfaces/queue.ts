/**
 * Queue/Event Interface
 * Message queuing and event processing
 */

import { ProviderContext } from '../types/context';

/**
 * Queue operation options
 */
export interface QueueBaseOptions {
  idempotencyKey?: string;
}

export interface EnqueueOptions extends QueueBaseOptions {
  delaySeconds?: number;
  priority?: number;
  messageGroupId?: string; // For FIFO queues
  deduplicationId?: string; // For FIFO queues
  attributes?: Record<string, string>;
}

export interface DequeueOptions extends QueueBaseOptions {
  maxMessages?: number;
  visibilityTimeoutSeconds?: number;
  waitTimeSeconds?: number; // Long polling
}

/**
 * Message structure
 */
export interface Message {
  id: string;
  body: Uint8Array;
  attributes: Record<string, string>;
  receiptHandle: string;
  enqueuedAt: Date;
  approximateReceiveCount: number;
  messageGroupId?: string;
  deduplicationId?: string;
}

/**
 * Queue operation results
 */
export interface EnqueueResult {
  messageId: string;
  md5OfBody: string;
  sequenceNumber?: string; // For FIFO queues
}

export interface DequeueResult {
  messages: Message[];
}

export interface QueueInfo {
  name: string;
  type: 'standard' | 'fifo';
  approximateMessageCount: number;
  approximateInFlightCount: number;
  createdAt: Date;
  attributes: Record<string, any>;
}

/**
 * Queue interface
 */
export interface QueueProvider {
  /**
   * Send a message to the queue
   */
  enqueue(
    ctx: ProviderContext,
    queueName: string,
    body: Uint8Array,
    options?: EnqueueOptions
  ): Promise<EnqueueResult>;
  
  /**
   * Receive messages from the queue
   */
  dequeue(
    ctx: ProviderContext,
    queueName: string,
    options?: DequeueOptions
  ): Promise<DequeueResult>;
  
  /**
   * Acknowledge message processing (delete from queue)
   */
  ack(
    ctx: ProviderContext,
    queueName: string,
    receiptHandle: string,
    options?: QueueBaseOptions
  ): Promise<void>;
  
  /**
   * Negative acknowledge (return message to queue)
   */
  nack(
    ctx: ProviderContext,
    queueName: string,
    receiptHandle: string,
    options?: {
      visibilityTimeoutSeconds?: number;
    } & QueueBaseOptions
  ): Promise<void>;
  
  /**
   * Create a new queue
   */
  createQueue(
    ctx: ProviderContext,
    queueName: string,
    options?: {
      type?: 'standard' | 'fifo';
      visibilityTimeoutSeconds?: number;
      messageRetentionPeriodSeconds?: number;
      maxReceiveCount?: number;
      deadLetterQueueName?: string;
      attributes?: Record<string, any>;
    } & QueueBaseOptions
  ): Promise<QueueInfo>;
  
  /**
   * Delete a queue
   */
  deleteQueue(
    ctx: ProviderContext,
    queueName: string,
    options?: QueueBaseOptions
  ): Promise<void>;
  
  /**
   * Get queue information and statistics
   */
  getQueue(
    ctx: ProviderContext,
    queueName: string,
    options?: QueueBaseOptions
  ): Promise<QueueInfo>;
  
  /**
   * List queues
   */
  listQueues(
    ctx: ProviderContext,
    options?: {
      prefix?: string;
      maxQueues?: number;
      nextToken?: string;
    } & QueueBaseOptions
  ): Promise<{
    queues: QueueInfo[];
    nextToken?: string;
  }>;
  
  /**
   * Purge all messages from a queue
   */
  purgeQueue(
    ctx: ProviderContext,
    queueName: string,
    options?: QueueBaseOptions
  ): Promise<void>;
  
  /**
   * Change message visibility timeout
   */
  changeMessageVisibility(
    ctx: ProviderContext,
    queueName: string,
    receiptHandle: string,
    visibilityTimeoutSeconds: number,
    options?: QueueBaseOptions
  ): Promise<void>;
}