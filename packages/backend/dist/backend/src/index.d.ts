import { Server as SocketIOServer } from 'socket.io';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
declare const app: import("express-serve-static-core").Express;
declare const httpServer: import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>;
declare const io: SocketIOServer<import("socket.io").DefaultEventsMap, import("socket.io").DefaultEventsMap, import("socket.io").DefaultEventsMap, any>;
declare const redis: Redis;
declare const prisma: PrismaClient<{
    log: ("error" | "warn")[];
}, never, import("@prisma/client/runtime/library").DefaultArgs>;
export { app, httpServer as server, io, redis, prisma };
//# sourceMappingURL=index.d.ts.map