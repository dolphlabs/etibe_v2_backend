import { Injectable, Logger } from "@nestjs/common";
import { NotificationRepository } from "./../repositories/notification.repository";
import {
  Notification,
  NotificationDocument,
} from "./../schemas/notification.schema";
import { QueryOptions, PaginatedResult } from "../../../shared/types";
import { Types } from "mongoose";

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly notificationRepository: NotificationRepository,
  ) {}

  async createNotification(
    data: Partial<Notification>,
  ): Promise<NotificationDocument> {
    return this.notificationRepository.create(data);
  }

  async getUserNotifications(
    userId: string | Types.ObjectId,
    options: QueryOptions & { isRead?: boolean } = {},
  ): Promise<PaginatedResult<NotificationDocument>> {
    const { isRead, ...queryOptions } = options;
    const filter: any = { userId: new Types.ObjectId(userId.toString()) };

    if (isRead !== undefined) {
      filter.isRead = isRead;
    }

    return this.notificationRepository.findAllWithPagination(
      filter,
      queryOptions,
    );
  }

  async markAsRead(notificationId: string, userId: string): Promise<void> {
    await this.notificationRepository.update(notificationId, {
      isRead: true,
    } as any);
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationRepository.updateMany(
      { userId: new Types.ObjectId(userId), isRead: false },
      { isRead: true } as any,
    );
  }

  async clearAll(userId: string): Promise<void> {
    await this.notificationRepository.softDeleteMany({
      userId: new Types.ObjectId(userId),
    });
  }
}
