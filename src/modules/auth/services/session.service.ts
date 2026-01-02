import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { nanoid } from "nanoid";
import {
  EtibeSession,
  SessionMetadata,
} from "../../../shared/types/session.types";
import { APP_CONSTANTS } from "../../../shared/constants";
import { RedisService } from "../../../core/services/redis.service";

const SESSION_PREFIX = "session:";
const USER_SESSIONS_PREFIX = "user_sessions:";
const DEVICE_SESSION_PREFIX = "device_session:";

export interface JwtSessionPayload {
  sid: string;
  uid: string;
  did: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly sessionTtlMs: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService
  ) {
    this.sessionTtlMs =
      (APP_CONSTANTS.SESSION_TTL_DAYS || 7) * 24 * 60 * 60 * 1000;
  }

  async createSession(
    userId: string,
    deviceId: string,
    metadata: SessionMetadata
  ): Promise<{ session: EtibeSession; token: string }> {
    const sessionId = nanoid(32);
    const now = Date.now();

    const session: EtibeSession = {
      sessionId,
      userId,
      deviceId,
      metadata,
      createdAt: new Date(now),
      lastActive: new Date(now),
      expiresAt: new Date(now + this.sessionTtlMs),
      isValid: true,
    };

    // Invalidate previous session for this device
    await this.invalidateDeviceSession(userId, deviceId);

    // Store session in Redis
    const sessionKey = `${SESSION_PREFIX}${sessionId}`;
    try {
      await this.redisService.set(sessionKey, session, this.sessionTtlMs);

      // Verify session was stored
      const storedSession = await this.redisService.get(sessionKey);
      if (!storedSession) {
        this.logger.error(`[SESSION] Failed to store session in Redis!`);
      } else {
        this.logger.log(`[SESSION] Session stored successfully`);
      }
    } catch (error) {
      this.logger.error(`[SESSION] Redis error during session storage:`, error);
      throw error;
    }

    await this.trackUserSession(userId, sessionId);

    const deviceKey = `${DEVICE_SESSION_PREFIX}${userId}:${deviceId}`;
    await this.redisService.set(deviceKey, sessionId, this.sessionTtlMs);

    const payload: JwtSessionPayload = {
      sid: sessionId,
      uid: userId,
      did: deviceId,
    };

    const token = this.jwtService.sign(payload);

    return { session, token };
  }

  async verifyToken(token: string): Promise<JwtSessionPayload | null> {
    try {
      const payload = this.jwtService.verify<JwtSessionPayload>(token);
      return payload;
    } catch (error) {
      this.logger.debug(
        `Token verification failed: ${(error as Error).message}`
      );
      return null;
    }
  }

  async getSession(sessionId: string): Promise<EtibeSession | null> {
    const sessionKey = `${SESSION_PREFIX}${sessionId}`;
    const session = await this.redisService.get<EtibeSession>(sessionKey);
    return session || null;
  }

  async validateSession(
    sessionId: string,
    deviceId: string
  ): Promise<EtibeSession | null> {
    const session = await this.getSession(sessionId);

    if (!session) {
      this.logger.debug(`Session not found: ${sessionId}`);
      return null;
    }

    if (!session.isValid) {
      this.logger.debug(`Session invalidated: ${sessionId}`);
      return null;
    }

    if (session.deviceId !== deviceId) {
      this.logger.warn(`Device mismatch for session ${sessionId}`);
      return null;
    }

    if (new Date() > new Date(session.expiresAt)) {
      this.logger.debug(`Session expired: ${sessionId}`);
      await this.invalidateSession(sessionId);
      return null;
    }

    return session;
  }

  async validateTokenAndSession(
    token: string,
    deviceId?: string
  ): Promise<EtibeSession | null> {
    const payload = await this.verifyToken(token);

    if (!payload) {
      return null;
    }

    const session = await this.validateSession(
      payload.sid,
      deviceId || payload.did
    );

    return session;
  }

  async touchSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);

    if (session) {
      session.lastActive = new Date();
      const sessionKey = `${SESSION_PREFIX}${sessionId}`;
      const ttlRemaining = new Date(session.expiresAt).getTime() - Date.now();
      await this.redisService.set(
        sessionKey,
        session,
        Math.max(ttlRemaining, 0)
      );
    }
  }

  async invalidateSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);

    if (session) {
      const sessionKey = `${SESSION_PREFIX}${sessionId}`;
      await this.redisService.del(sessionKey);

      // Remove from user sessions
      await this.removeUserSession(session.userId, sessionId);

      // Remove device mapping
      const deviceKey = `${DEVICE_SESSION_PREFIX}${session.userId}:${session.deviceId}`;
      await this.redisService.del(deviceKey);

      this.logger.log(`Session invalidated: ${sessionId}`);
    }
  }

  async invalidateAllUserSessions(userId: string): Promise<number> {
    const userSessionsKey = `${USER_SESSIONS_PREFIX}${userId}`;
    const sessionIds = await this.redisService.get<string[]>(userSessionsKey);

    if (!sessionIds || sessionIds.length === 0) {
      return 0;
    }

    for (const sessionId of sessionIds) {
      await this.invalidateSession(sessionId);
    }

    await this.redisService.del(userSessionsKey);

    this.logger.log(`All sessions invalidated for user ${userId}`);
    return sessionIds.length;
  }

  async getUserSessions(userId: string): Promise<EtibeSession[]> {
    const userSessionsKey = `${USER_SESSIONS_PREFIX}${userId}`;
    const sessionIds = await this.redisService.get<string[]>(userSessionsKey);

    if (!sessionIds) {
      return [];
    }

    const sessions: EtibeSession[] = [];

    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);
      if (session && session.isValid) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  private async trackUserSession(
    userId: string,
    sessionId: string
  ): Promise<void> {
    const userSessionsKey = `${USER_SESSIONS_PREFIX}${userId}`;
    const existingSessions =
      (await this.redisService.get<string[]>(userSessionsKey)) || [];

    if (!existingSessions.includes(sessionId)) {
      existingSessions.push(sessionId);
      await this.redisService.set(
        userSessionsKey,
        existingSessions,
        this.sessionTtlMs
      );
    }
  }

  private async removeUserSession(
    userId: string,
    sessionId: string
  ): Promise<void> {
    const userSessionsKey = `${USER_SESSIONS_PREFIX}${userId}`;
    const existingSessions =
      (await this.redisService.get<string[]>(userSessionsKey)) || [];

    const updatedSessions = existingSessions.filter((id) => id !== sessionId);
    await this.redisService.set(
      userSessionsKey,
      updatedSessions,
      this.sessionTtlMs
    );
  }

  private async invalidateDeviceSession(
    userId: string,
    deviceId: string
  ): Promise<void> {
    const deviceKey = `${DEVICE_SESSION_PREFIX}${userId}:${deviceId}`;
    const existingSessionId = await this.redisService.get<string>(deviceKey);

    if (existingSessionId) {
      await this.invalidateSession(existingSessionId);
    }
  }
}
