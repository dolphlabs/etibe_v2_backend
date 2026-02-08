import { Controller, Get, Patch, Delete, Param, Query } from "@nestjs/common";
import { NotificationService } from "../services/notification.service";
import { CurrentUserId } from "../../auth/decorators/current-user.decorator";
import { NotificationQueryDto } from "../dto/notification-query.dto";

@Controller("notifications")
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  async getMyNotifications(
    @CurrentUserId() userId: string,
    @Query() query: NotificationQueryDto,
  ) {
    return this.notificationService.getUserNotifications(userId, query);
  }

  @Patch(":id/read")
  async markAsRead(@Param("id") id: string, @CurrentUserId() userId: string) {
    await this.notificationService.markAsRead(id, userId);
    return { success: true };
  }

  @Patch("mark-all-read")
  async markAllRead(@CurrentUserId() userId: string) {
    await this.notificationService.markAllAsRead(userId);
    return { success: true };
  }

  @Delete("clear-all")
  async clearAll(@CurrentUserId() userId: string) {
    await this.notificationService.clearAll(userId);
    return { success: true };
  }
}
