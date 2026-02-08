import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Req,
  BadRequestException,
} from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { UserService } from "../services";
import { CloudinaryService } from "../../utilities/services/cloudinary.service";
import {
  CreateUserDto,
  UpdateUserDto,
  UserQueryDto,
  UpdateProfileDto,
} from "../dto";
import { UserDocument } from "../schemas";
import { PaginatedResult } from "../../../shared/types";
import { ParseObjectIdPipe } from "../../../core/pipes";
import { Public } from "../../../core/decorators";
import { CurrentUserId } from "../../auth/decorators/current-user.decorator";
import { Types } from "mongoose";

@Controller("users")
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @Get()
  @Public()
  async findAll(
    @Query() queryDto: UserQueryDto,
  ): Promise<PaginatedResult<UserDocument>> {
    return this.userService.findAll(queryDto);
  }

  @Get(":id")
  async findById(
    @Param("id", ParseObjectIdPipe) id: string,
  ): Promise<UserDocument> {
    return this.userService.findById(id);
  }

  @Patch(":id")
  async update(
    @Param("id", ParseObjectIdPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<UserDocument> {
    return this.userService.update(id, updateUserDto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async softDelete(
    @Param("id", ParseObjectIdPipe) id: string,
  ): Promise<UserDocument> {
    return this.userService.softDelete(id);
  }

  @Patch(":id/restore")
  async restore(
    @Param("id", ParseObjectIdPipe) id: string,
  ): Promise<UserDocument> {
    return this.userService.restore(id);
  }

  @Patch(":id/deactivate")
  async deactivate(
    @Param("id", ParseObjectIdPipe) id: string,
  ): Promise<UserDocument> {
    return this.userService.deactivate(id);
  }

  @Patch(":id/activate")
  async activate(
    @Param("id", ParseObjectIdPipe) id: string,
  ): Promise<UserDocument> {
    return this.userService.activate(id);
  }

  @Patch("profile")
  async updateProfile(
    @CurrentUserId() userId: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ): Promise<UserDocument> {
    return this.userService.updateProfile(userId, updateProfileDto);
  }

  @Post("profile/avatar")
  @HttpCode(HttpStatus.OK)
  async uploadAvatar(
    @CurrentUserId() userId: string,
    @Req() req: FastifyRequest,
  ): Promise<{ avatar: string }> {
    if (!req.isMultipart()) {
      throw new BadRequestException("Request is not multipart");
    }

    const data = await req.file();
    if (!data) {
      throw new BadRequestException("No file uploaded");
    }

    if (!data.mimetype.startsWith("image/")) {
      throw new BadRequestException("Only image files are allowed");
    }

    try {
      const buffer = await data.toBuffer();
      const result = await this.cloudinaryService.uploadImage(
        buffer,
        "avatars",
        `user-${userId}-${Date.now()}`,
      );

      const avatarUrl = (result as any).secure_url;
      await this.userService.updateProfile(userId, { avatar: avatarUrl });

      return { avatar: avatarUrl };
    } catch (error) {
      throw new BadRequestException("Failed to upload avatar");
    }
  }
}
