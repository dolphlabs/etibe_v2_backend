import { Types } from "mongoose";

/**
 * Device metadata for session tracking and FCM notifications.
 */
export interface DeviceMetadata {
  deviceId: string;
  os: string;
  browser?: string;
  userAgent: string;
}

export interface SessionMetadata {
  ip: string;
  device: DeviceMetadata;
  location?: {
    country?: string;
    city?: string;
  };
}

export interface EtibeSession {
  sessionId: string;
  userId: string;
  deviceId: string;
  metadata: SessionMetadata;
  createdAt: Date;
  lastActive: Date;
  expiresAt: Date;
  isValid: boolean;
}

export interface SessionCookiePayload {
  sid: string;
  uid: string;
  did: string;
}

export interface AuthenticatedUser {
  _id: Types.ObjectId;
  id: string;
  email: string;
  username?: string;
  firstName: string;
  lastName: string;
  fullName: string;
  avatar?: string;
  isVerified: boolean;
  nearAccountId?: string;
  sessionId: string;
  deviceId: string;
}

export interface AuthenticatedRequest {
  session: SessionCookiePayload;
  user: AuthenticatedUser;
}
