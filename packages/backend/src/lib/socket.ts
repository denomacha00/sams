import type { Server as SocketIOServer } from 'socket.io';

let socketServer: SocketIOServer | null = null;

export function registerSocketServer(io: SocketIOServer): void {
  socketServer = io;
}

export function getSocketIO(): SocketIOServer {
  if (!socketServer) {
    throw new Error('[Socket] Socket.io server not initialized');
  }
  return socketServer;
}
