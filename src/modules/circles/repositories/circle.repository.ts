import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types, UpdateQuery } from "mongoose";
import { BaseRepository, FilterQuery } from "../../../core/repositories";
import { Circle, CircleDocument } from "../schemas";

@Injectable()
export class CircleRepository extends BaseRepository<CircleDocument> {
  constructor(
    @InjectModel(Circle.name)
    private readonly circleModel: Model<CircleDocument>,
  ) {
    super(circleModel);
  }

  async findByInviteCode(inviteCode: string): Promise<CircleDocument | null> {
    return this.findOne({
      inviteCode: inviteCode.toUpperCase(),
    } as FilterQuery<CircleDocument>);
  }

  async findByContractAddress(
    contractAddress: string,
  ): Promise<CircleDocument | null> {
    return this.findOne({
      contractAddress,
    } as FilterQuery<CircleDocument>);
  }

  async findUserCircles(userId: string): Promise<CircleDocument[]> {
    return this.findAll({
      "members.userId": new Types.ObjectId(userId),
      "members.status": "ACTIVE",
    } as FilterQuery<CircleDocument>);
  }

  async findCreatedCircles(userId: string): Promise<CircleDocument[]> {
    return this.findAll({
      creatorId: new Types.ObjectId(userId),
    } as FilterQuery<CircleDocument>);
  }

  async addMember(
    circleId: string,
    member: {
      userId: Types.ObjectId;
      position: number;
      status: string;
    },
  ): Promise<CircleDocument | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.circleModel
      .findByIdAndUpdate(
        circleId,
        {
          $push: {
            members: {
              ...member,
              joinedAt: new Date(),
              hasReceivedPayout: false,
            },
          },
        } as UpdateQuery<CircleDocument>,
        { new: true },
      )
      .lean()
      .exec() as Promise<CircleDocument | null>;
  }

  async removeMember(
    circleId: string,
    userId: string,
  ): Promise<CircleDocument | null> {
    return this.circleModel
      .findByIdAndUpdate(
        circleId,
        {
          $set: {
            "members.$[elem].status": "REMOVED",
          },
        } as UpdateQuery<CircleDocument>,
        {
          arrayFilters: [{ "elem.userId": new Types.ObjectId(userId) }],
          new: true,
        },
      )
      .lean()
      .exec() as Promise<CircleDocument | null>;
  }

  async updateStatus(
    circleId: string,
    status: string,
  ): Promise<CircleDocument | null> {
    return this.update(circleId, { status } as Partial<CircleDocument>);
  }

  async setContractAddress(
    circleId: string,
    contractAddress: string,
  ): Promise<CircleDocument | null> {
    return this.update(circleId, {
      contractAddress,
      status: "RECRUITING",
    } as Partial<CircleDocument>);
  }

  async incrementTotalContributed(
    circleId: string,
    amount: string,
  ): Promise<CircleDocument | null> {
    return this.circleModel
      .findByIdAndUpdate(
        circleId,
        {
          $inc: { totalContributed: parseFloat(amount) },
        },
        { new: true },
      )
      .lean()
      .exec() as Promise<CircleDocument | null>;
  }

  async advanceRound(circleId: string): Promise<CircleDocument | null> {
    return this.circleModel
      .findByIdAndUpdate(
        circleId,
        {
          $inc: { currentRound: 1 },
          $set: { totalContributed: "0" },
        },
        { new: true },
      )
      .lean()
      .exec() as Promise<CircleDocument | null>;
  }

  async markPayoutReceived(
    circleId: string,
    userId: string,
    transactionHash: string,
  ): Promise<CircleDocument | null> {
    return this.circleModel
      .findByIdAndUpdate(
        circleId,
        {
          $set: {
            "members.$[elem].hasReceivedPayout": true,
            "members.$[elem].payoutDate": new Date(),
            "members.$[elem].payoutTransactionHash": transactionHash,
          },
        } as UpdateQuery<CircleDocument>,
        {
          arrayFilters: [{ "elem.userId": new Types.ObjectId(userId) }],
          new: true,
        },
      )
      .lean()
      .exec() as Promise<CircleDocument | null>;
  }

  async inviteCodeExists(inviteCode: string): Promise<boolean> {
    return this.exists({
      inviteCode: inviteCode.toUpperCase(),
    } as FilterQuery<CircleDocument>);
  }

  async countUserCircles(userId: string): Promise<number> {
    return this.count({
      "members.userId": new Types.ObjectId(userId),
      "members.status": "ACTIVE",
    } as FilterQuery<CircleDocument>);
  }
}
