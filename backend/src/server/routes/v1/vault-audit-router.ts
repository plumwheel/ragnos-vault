import { z } from "zod";
import { FastifyPluginAsync } from "fastify";

// Audit log API routes
export const registerVaultAuditRoutes: FastifyPluginAsync = async (server) => {
  await server.register(async (auditApi) => {
    // GET /api/v1/vault/workspaces/:workspaceId/audit
    auditApi.route({
      method: "GET",
      url: "/workspaces/:workspaceId/audit",
      schema: {
        params: z.object({
          workspaceId: z.string().uuid()
        }),
        querystring: z.object({
          limit: z.coerce.number().min(1).max(200).default(50),
          cursor: z.string().optional(), // ISO timestamp cursor
          action: z.enum(["CREATE", "READ", "UPDATE", "DELETE", "ROTATE", "LOGIN"]).optional(),
          resourceType: z.enum(["secret", "workspace", "token", "keyring"]).optional(),
          resourceId: z.string().optional(),
          userId: z.string().optional()
        }),
        response: {
          200: z.object({
            items: z.array(z.object({
              id: z.string().uuid(),
              action: z.string(),
              resourceType: z.string(),
              resourceId: z.string().nullable(),
              userId: z.string().nullable(),
              ipAddress: z.string().nullable(),
              userAgent: z.string().nullable(),
              success: z.boolean(),
              errorMessage: z.string().nullable(),
              metadata: z.record(z.any()),
              createdAt: z.string()
            })),
            nextCursor: z.string().nullable(),
            hasMore: z.boolean()
          })
        }
      },
      preHandler: [
        server.authorizeWorkspace,
        server.requirePermission("audit:read")
      ],
      handler: async (req, res) => {
        const { workspaceId } = req.params;
        const { limit, cursor, action, resourceType, resourceId, userId } = req.query;

        try {
          let query = server.db('vault_audit_logs')
            .where('workspace_id', workspaceId)
            .orderBy('created_at', 'desc');

          // Apply filters
          if (cursor) {
            query = query.where('created_at', '<', new Date(cursor));
          }
          
          if (action) {
            query = query.where('action', action);
          }
          
          if (resourceType) {
            query = query.where('resource_type', resourceType);
          }
          
          if (resourceId) {
            query = query.where('resource_id', resourceId);
          }
          
          if (userId) {
            query = query.where('user_id', userId);
          }

          // Get one extra record to check if there are more
          const records = await query
            .select(
              'id',
              'action', 
              'resource_type as resourceType',
              'resource_id as resourceId',
              'user_id as userId',
              'ip_address as ipAddress',
              'user_agent as userAgent',
              'success',
              'error_message as errorMessage',
              'metadata',
              'created_at as createdAt'
            )
            .limit(limit + 1);

          const hasMore = records.length > limit;
          const items = hasMore ? records.slice(0, -1) : records;
          const nextCursor = hasMore ? records[limit - 1].createdAt : null;

          // Log the audit query itself (meta!)
          setImmediate(() => {
            server.db('vault_audit_logs').insert({
              id: server.db.raw('uuid_generate_v4()'),
              workspace_id: workspaceId,
              action: 'READ',
              resource_type: 'audit',
              resource_id: 'query',
              user_id: req.vault?.userId || 'system',
              token_id: req.vault?.tokenId,
              ip_address: req.ip,
              user_agent: req.headers['user-agent'],
              request_id: req.vault?.requestId || 'unknown',
              success: true,
              metadata: { filters: { action, resourceType, resourceId, userId }, limit }
            }).catch(err => server.log.warn('Failed to log audit query:', err));
          });

          return res.send({
            items: items.map(item => ({
              ...item,
              createdAt: item.createdAt.toISOString()
            })),
            nextCursor: nextCursor ? nextCursor.toISOString() : null,
            hasMore
          });
        } catch (error) {
          server.log.error('Failed to query audit logs:', error);
          throw server.httpErrors.internalServerError('Failed to query audit logs');
        }
      }
    });

    // GET /api/v1/vault/workspaces/:workspaceId/audit/stats
    auditApi.route({
      method: "GET", 
      url: "/workspaces/:workspaceId/audit/stats",
      schema: {
        params: z.object({
          workspaceId: z.string().uuid()
        }),
        querystring: z.object({
          days: z.coerce.number().min(1).max(90).default(7)
        }),
        response: {
          200: z.object({
            totalEvents: z.number(),
            eventsByAction: z.record(z.number()),
            eventsByDay: z.array(z.object({
              date: z.string(),
              count: z.number()
            })),
            topUsers: z.array(z.object({
              userId: z.string(),
              count: z.number()
            })),
            errorRate: z.number()
          })
        }
      },
      preHandler: [
        server.authorizeWorkspace,
        server.requirePermission("audit:read")
      ],
      handler: async (req, res) => {
        const { workspaceId } = req.params;
        const { days } = req.query;

        try {
          const since = new Date();
          since.setDate(since.getDate() - days);

          const baseQuery = server.db('vault_audit_logs')
            .where('workspace_id', workspaceId)
            .where('created_at', '>=', since);

          // Total events
          const totalResult = await baseQuery.clone().count('* as count').first();
          const totalEvents = parseInt(totalResult.count as string);

          // Events by action
          const actionResults = await baseQuery.clone()
            .select('action')
            .count('* as count')
            .groupBy('action');
          
          const eventsByAction = actionResults.reduce((acc, row) => {
            acc[row.action] = parseInt(row.count as string);
            return acc;
          }, {} as Record<string, number>);

          // Events by day
          const dayResults = await baseQuery.clone()
            .select(server.db.raw('DATE(created_at) as date'))
            .count('* as count')
            .groupBy(server.db.raw('DATE(created_at)'))
            .orderBy('date', 'desc');

          const eventsByDay = dayResults.map(row => ({
            date: row.date,
            count: parseInt(row.count as string)
          }));

          // Top users
          const userResults = await baseQuery.clone()
            .select('user_id as userId')
            .count('* as count')
            .whereNotNull('user_id')
            .groupBy('user_id')
            .orderBy('count', 'desc')
            .limit(10);

          const topUsers = userResults.map(row => ({
            userId: row.userId,
            count: parseInt(row.count as string)
          }));

          // Error rate
          const errorResult = await baseQuery.clone()
            .select(
              server.db.raw('COUNT(*) as total'),
              server.db.raw('COUNT(CASE WHEN success = false THEN 1 END) as errors')
            )
            .first();

          const errorRate = totalEvents > 0 
            ? parseFloat((parseInt(errorResult.errors as string) / totalEvents * 100).toFixed(2))
            : 0;

          return res.send({
            totalEvents,
            eventsByAction,
            eventsByDay,
            topUsers,
            errorRate
          });
        } catch (error) {
          server.log.error('Failed to get audit stats:', error);
          throw server.httpErrors.internalServerError('Failed to get audit statistics');
        }
      }
    });
  }, { prefix: "/vault" });
};

export default registerVaultAuditRoutes;