import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { BaseRepository, FilterQuery } from "../../../core/repositories";
import { User, UserDocument } from "../schemas";

@Injectable()
export class UserRepository extends BaseRepository<UserDocument> {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>
  ) {
    super(userModel);
  }

  async findByEmail(
    email: string,
    includePassword = false
  ): Promise<UserDocument | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = this.userModel
      .findOne({
        email: email.toLowerCase(),
        $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
      })
      .lean();

    if (includePassword) {
      query = query.select("+password");
    }

    const result = await query.exec();
    return result as UserDocument | null;
  }

  /**
   * Checks if an email already exists.
   *
   * @param email - The email to check
   * @returns Boolean indicating if email exists
   */
  async emailExists(email: string): Promise<boolean> {
    const result = await this.userModel.exists({
      email: email.toLowerCase(),
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    });
    return result !== null;
  }

  async updateLastLogin(userId: string): Promise<UserDocument | null> {
    return this.update(userId, {
      lastLoginAt: new Date(),
    } as Partial<UserDocument>);
  }

  async searchUsers(searchTerm: string): Promise<UserDocument[]> {
    const searchRegex = new RegExp(searchTerm, "i");

    return this.findAll({
      $or: [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
      ],
    } as FilterQuery<UserDocument>);
  }

  async findActiveUsers(): Promise<UserDocument[]> {
    return this.findAll({ isActive: true } as FilterQuery<UserDocument>);
  }

  async deactivateUser(userId: string): Promise<UserDocument | null> {
    return this.update(userId, { isActive: false } as Partial<UserDocument>);
  }

  async activateUser(userId: string): Promise<UserDocument | null> {
    return this.update(userId, { isActive: true } as Partial<UserDocument>);
  }

  async verifyUser(userId: string): Promise<UserDocument | null> {
    return this.update(userId, { isVerified: true } as Partial<UserDocument>);
  }
}
