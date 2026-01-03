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

  async findByUsername(
    username: string,
    includePassword = false
  ): Promise<UserDocument | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = this.userModel
      .findOne({
        username: username.toLowerCase(),
        $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
      })
      .lean();

    if (includePassword) {
      query = query.select("+password");
    }

    const result = await query.exec();
    return result as UserDocument | null;
  }

  async emailExists(email: string): Promise<boolean> {
    const result = await this.userModel.exists({
      email: email.toLowerCase(),
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    });
    return result !== null;
  }

  async usernameExists(username: string): Promise<boolean> {
    const result = await this.userModel.exists({
      username: username.toLowerCase(),
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
        { username: searchRegex },
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

  async linkNearWallet(
    userId: string,
    walletAddress: string
  ): Promise<UserDocument | null> {
    return this.update(userId, {
      nearWalletAddress: walletAddress,
    } as Partial<UserDocument>);
  }

  async setResetPasswordToken(
    userId: string,
    hashedToken: string,
    expiresAt: Date
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        {
          resetPasswordToken: hashedToken,
          resetPasswordExpiresAt: expiresAt,
        },
        { new: true }
      )
      .lean()
      .exec() as Promise<UserDocument | null>;
  }

  /**
   * Find user by reset token - includes password and token fields for verification
   */
  async findByResetToken(hashedToken: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpiresAt: { $gt: new Date() },
        $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
      })
      .select("+password +resetPasswordToken")
      .lean()
      .exec() as Promise<UserDocument | null>;
  }

  async clearResetPasswordToken(userId: string): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        {
          $unset: {
            resetPasswordToken: 1,
            resetPasswordExpiresAt: 1,
          },
        },
        { new: true }
      )
      .lean()
      .exec() as Promise<UserDocument | null>;
  }

  async updatePassword(
    userId: string,
    hashedPassword: string
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        {
          password: hashedPassword,
          $unset: {
            resetPasswordToken: 1,
            resetPasswordExpiresAt: 1,
          },
        },
        { new: true }
      )
      .lean()
      .exec() as Promise<UserDocument | null>;
  }
}
