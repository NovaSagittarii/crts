import { describe, expect, test } from 'vitest';
import { io, type Socket } from 'socket.io-client';

import { createServer } from '../../../apps/server/src/server.js';
import type { RoomJoinedPayload, RoomMembershipPayload } from '#rts-engine';

function waitForSocketEvent<T>(
  socket: Socket,
  event: string,
  timeoutMs = 4000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    function handler(payload: T): void {
      clearTimeout(timer);
      resolve(payload);
    }

    socket.once(event, handler);
  });
}

function extractModuleEntryPath(html: string): string {
  const moduleScriptMatch =
    html.match(
      /<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*>/i,
    ) ??
    html.match(
      /<script[^>]*src=["']([^"']+)["'][^>]*type=["']module["'][^>]*>/i,
    );

  const entryPath = moduleScriptMatch?.[1];
  if (!entryPath) {
    throw new Error('Served HTML is missing a module entry script');
  }

  return entryPath;
}

describe('server bootstrap smoke', () => {
  test('serves executable module assets and reaches room membership', async () => {
    const server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
    const port = await server.start();
    const origin = `http://localhost:${port}`;
    let socket: Socket | null = null;

    try {
      const htmlResponse = await fetch(`${origin}/`);
      expect(htmlResponse.status).toBe(200);
      const html = await htmlResponse.text();

      const moduleEntryPath = extractModuleEntryPath(html);
      expect(moduleEntryPath.endsWith('.ts')).toBe(false);

      const moduleUrl = new URL(moduleEntryPath, `${origin}/`).toString();
      const moduleResponse = await fetch(moduleUrl);
      expect(moduleResponse.status).toBe(200);

      const contentType = (moduleResponse.headers.get('content-type') ?? '')
        .toLowerCase()
        .trim();
      expect(contentType).toContain('javascript');
      expect(contentType).not.toContain('video/mp2t');

      const moduleSource = await moduleResponse.text();
      expect(moduleSource.length).toBeGreaterThan(0);

      socket = io(origin, {
        autoConnect: false,
        transports: ['websocket'],
      });

      const joinedPromise = waitForSocketEvent<RoomJoinedPayload>(
        socket,
        'room:joined',
      );
      const membershipPromise = waitForSocketEvent<RoomMembershipPayload>(
        socket,
        'room:membership',
      );
      socket.connect();

      const joined = await joinedPromise;
      const membership = await membershipPromise;

      expect(membership.roomId).toBe(joined.roomId);
      expect(membership.roomCode).toBe(joined.roomCode);
      expect(
        membership.participants.some(
          ({ sessionId }) => sessionId === joined.playerId,
        ),
      ).toBe(true);
    } finally {
      socket?.close();
      await server.stop();
    }
  }, 20_000);
});
