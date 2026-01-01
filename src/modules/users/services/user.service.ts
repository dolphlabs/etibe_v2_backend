import {
  Injectable,
  ConflictException,
  NotFoundException,
  Inject,
} from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { UserRepository } from "../repositories";
import { FilterQuery } from "../../../core/repositories";
import { UserDocument } from "../schemas";
import { CreateUserDto, UpdateUserDto, UserQueryDto } from "../dto";
import { PaginatedResult, QueryOptions } from "../../../shared/types";
import { CACHE_KEYS, CACHE_TTL } from "../../../shared/constants";

@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
    const emailExists = await this.userRepository.emailExists(
      createUserDto.email
    );
    if (emailExists) {
      throw new ConflictException("Email already exists");
    }

    const hashedPassword = await this.hashPassword(createUserDto.password);

    const user = await this.userRepository.create({
      ...createUserDto,
      password: hashedPassword,
    } as Partial<UserDocument>);

    await this.invalidateUsersListCache();

    return user;
  }

  async findById(id: string): Promise<UserDocument> {
    const cacheKey = `${CACHE_KEYS.USER}:${id}`;

    const cachedUser = await this.cacheManager.get<UserDocument>(cacheKey);
    if (cachedUser) {
      return cachedUser;
    }

    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    await this.cacheManager.set(cacheKey, user, CACHE_TTL.MEDIUM * 1000);

    return user;
  }

  async findByEmail(
    email: string,
    includePassword = false
  ): Promise<UserDocument | null> {
    return this.userRepository.findByEmail(email, includePassword);
  }

  async findAll(
    queryDto: UserQueryDto
  ): Promise<PaginatedResult<UserDocument>> {
    const filter: FilterQuery<UserDocument> = {};

    if (queryDto.isActive !== undefined) {
      (filter as Record<string, unknown>).isActive = queryDto.isActive;
    }

    if (queryDto.isVerified !== undefined) {
      (filter as Record<string, unknown>).isVerified = queryDto.isVerified;
    }

    if (queryDto.search) {
      const searchRegex = new RegExp(queryDto.search, "i");
      (filter as Record<string, unknown>).$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
      ];
    }

    const options: QueryOptions = {
      page: queryDto.page || 1,
      limit: queryDto.limit || 10,
    };

    if (queryDto.sortBy) {
      options.sort = {
        [queryDto.sortBy]: queryDto.sortOrder === "asc" ? 1 : -1,
      };
    }

    return this.userRepository.findAllWithPagination(filter, options);
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto
  ): Promise<UserDocument> {
    const user = await this.userRepository.update(
      id,
      updateUserDto as Partial<UserDocument>
    );
    if (!user) {
      throw new NotFoundException("User not found");
    }

    await this.invalidateUserCache(id);

    return user;
  }

  async softDelete(id: string): Promise<UserDocument> {
    const user = await this.userRepository.softDelete(id);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    await this.invalidateUserCache(id);
    await this.invalidateUsersListCache();

    return user;
  }

  async restore(id: string): Promise<UserDocument> {
    const user = await this.userRepository.restore(id);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    await this.invalidateUserCache(id);
    await this.invalidateUsersListCache();

    return user;
  }

  async deactivate(id: string): Promise<UserDocument> {
    const user = await this.userRepository.deactivateUser(id);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    await this.invalidateUserCache(id);
    return user;
  }

  async activate(id: string): Promise<UserDocument> {
    const user = await this.userRepository.activateUser(id);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    await this.invalidateUserCache(id);
    return user;
  }

  private async hashPassword(password: string): Promise<string> {
    // TODO: Implement proper password hashing
    // Example with bcrypt:
    // return bcrypt.hash(password, 12);
    return password; // Placeholder - NEVER use in production
  }

  private async invalidateUserCache(userId: string): Promise<void> {
    await this.cacheManager.del(`${CACHE_KEYS.USER}:${userId}`);
  }

  private async invalidateUsersListCache(): Promise<void> {
    await this.cacheManager.del(CACHE_KEYS.USERS_LIST);
  }
}
