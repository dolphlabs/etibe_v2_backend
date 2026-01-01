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
} from "@nestjs/common";
import { UserService } from "../services";
import { CreateUserDto, UpdateUserDto, UserQueryDto } from "../dto";
import { UserDocument } from "../schemas";
import { PaginatedResult } from "../../../shared/types";
import { ParseObjectIdPipe } from "../../../core/pipes";
import { Public } from "../../../core/decorators";

@Controller("users")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createUserDto: CreateUserDto): Promise<UserDocument> {
    return this.userService.create(createUserDto);
  }

  @Get()
  @Public()
  async findAll(
    @Query() queryDto: UserQueryDto
  ): Promise<PaginatedResult<UserDocument>> {
    return this.userService.findAll(queryDto);
  }

  @Get(":id")
  async findById(
    @Param("id", ParseObjectIdPipe) id: string
  ): Promise<UserDocument> {
    return this.userService.findById(id);
  }

  @Patch(":id")
  async update(
    @Param("id", ParseObjectIdPipe) id: string,
    @Body() updateUserDto: UpdateUserDto
  ): Promise<UserDocument> {
    return this.userService.update(id, updateUserDto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  async softDelete(
    @Param("id", ParseObjectIdPipe) id: string
  ): Promise<UserDocument> {
    return this.userService.softDelete(id);
  }

  @Patch(":id/restore")
  async restore(
    @Param("id", ParseObjectIdPipe) id: string
  ): Promise<UserDocument> {
    return this.userService.restore(id);
  }

  @Patch(":id/deactivate")
  async deactivate(
    @Param("id", ParseObjectIdPipe) id: string
  ): Promise<UserDocument> {
    return this.userService.deactivate(id);
  }

  @Patch(":id/activate")
  async activate(
    @Param("id", ParseObjectIdPipe) id: string
  ): Promise<UserDocument> {
    return this.userService.activate(id);
  }
}
