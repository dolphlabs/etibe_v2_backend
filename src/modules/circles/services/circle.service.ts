import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
} from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { Types } from "mongoose";
import { nanoid } from "nanoid";
import { CircleRepository } from "../repositories/circle.repository";
import { TransactionRepository } from "../repositories/transaction.repository";
import { NearService } from "../../blockchain/services/near.service";
import { CircleDocument } from "../schemas";
import { CreateCircleDto, JoinCircleDto } from "../dto/circle.dto";
import {
  CircleStatus,
  TransactionType,
  TransactionStatus,
  PayoutFrequency,
} from "../../../shared/enums/circle.enums";
import {
  CACHE_KEYS,
  CACHE_TTL,
  APP_CONSTANTS,
} from "../../../shared/constants";
import { ContributionProgress } from "../../../shared/enums/circle.enums";

@Injectable()
export class CircleService {
  private readonly logger = new Logger(CircleService.name);

  constructor(
    private readonly circleRepository: CircleRepository,
    private readonly transactionRepository: TransactionRepository,
    private readonly nearService: NearService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache
  ) {}

  async createCircle(
    creatorId: string,
    dto: CreateCircleDto
  ): Promise<CircleDocument> {
    const inviteCode = await this.generateUniqueInviteCode();

    const totalRounds = dto.maxMembers;

    const startDate = new Date(dto.startDate);
    const nextPayoutDate = this.calculateNextPayoutDate(
      startDate,
      dto.contributionSettings.frequency
    );

    const circle = await this.circleRepository.create({
      name: dto.name,
      description: dto.description,
      logoUrl: dto.logoUrl,
      creatorId: new Types.ObjectId(creatorId),
      contributionSettings: dto.contributionSettings,
      maxMembers: dto.maxMembers,
      currentRound: 0,
      totalRounds,
      status: CircleStatus.PENDING,
      startDate,
      nextPayoutDate,
      inviteCode,
      inviteLink: `${process.env.APP_URL}/join/${inviteCode}`,
      isPrivate: dto.isPrivate ?? false,
      members: [
        {
          userId: new Types.ObjectId(creatorId),
          position: 1,
          hasReceivedPayout: false,
          joinedAt: new Date(),
          status: "ACTIVE",
        },
      ],
      totalContributed: "0",
    } as Partial<CircleDocument>);

    this.logger.log(`Circle created: ${circle.name} by user ${creatorId}`);

    await this.invalidateUserCirclesCache(creatorId);

    return circle;
  }

  async getCircleById(circleId: string): Promise<CircleDocument> {
    const cacheKey = `${CACHE_KEYS.CIRCLE}:${circleId}`;
    const cached = await this.cacheManager.get<CircleDocument>(cacheKey);

    if (cached) {
      return cached;
    }

    const circle = await this.circleRepository.findById(circleId);

    if (!circle) {
      throw new NotFoundException("Circle not found");
    }

    await this.cacheManager.set(cacheKey, circle, CACHE_TTL.MEDIUM * 1000);

    return circle;
  }

  async getCircleByInviteCode(inviteCode: string): Promise<CircleDocument> {
    const circle = await this.circleRepository.findByInviteCode(inviteCode);

    if (!circle) {
      throw new NotFoundException("Circle not found");
    }

    return circle;
  }

  async getUserCircles(userId: string): Promise<CircleDocument[]> {
    const cacheKey = `${CACHE_KEYS.USER_CIRCLES}:${userId}`;
    const cached = await this.cacheManager.get<CircleDocument[]>(cacheKey);

    if (cached) {
      return cached;
    }

    const circles = await this.circleRepository.findUserCircles(userId);

    await this.cacheManager.set(cacheKey, circles, CACHE_TTL.SHORT * 1000);

    return circles;
  }

  async joinCircle(
    userId: string,
    dto: JoinCircleDto
  ): Promise<CircleDocument> {
    let circle: CircleDocument | null;

    if (dto.channelAddress) {
      circle = await this.circleRepository.findByContractAddress(
        dto.channelAddress
      );

      if (!circle) {
        throw new NotFoundException(
          "Circle not found for this channel address"
        );
      }

      if (dto.nearAccountId) {
        const isWhitelisted = await this.nearService.isUserWhitelisted(
          dto.channelAddress,
          dto.nearAccountId
        );

        if (!isWhitelisted) {
          throw new BadRequestException(
            "Your NEAR account is not whitelisted for this circle"
          );
        }
      }
    } else if (dto.inviteCode) {
      circle = await this.circleRepository.findByInviteCode(dto.inviteCode);

      if (!circle) {
        throw new NotFoundException("Invalid invite code");
      }
    } else {
      throw new BadRequestException(
        "Either invite code or channel address is required"
      );
    }

    if (circle.status !== CircleStatus.RECRUITING) {
      throw new BadRequestException("This circle is not accepting new members");
    }

    const activeMembers = circle.members.filter((m) => m.status === "ACTIVE");
    if (activeMembers.length >= circle.maxMembers) {
      throw new BadRequestException("This circle is full");
    }

    const isAlreadyMember = circle.members.some(
      (m) => m.userId.toString() === userId && m.status === "ACTIVE"
    );

    if (isAlreadyMember) {
      throw new ConflictException("You are already a member of this circle");
    }

    const nextPosition = activeMembers.length + 1;

    const updatedCircle = await this.circleRepository.addMember(
      circle._id.toString(),
      {
        userId: new Types.ObjectId(userId),
        position: nextPosition,
        status: "ACTIVE",
      }
    );

    if (!updatedCircle) {
      throw new BadRequestException("Failed to join circle");
    }

    this.logger.log(`User ${userId} joined circle ${circle.name}`);

    await this.invalidateCircleCache(circle._id.toString());
    await this.invalidateUserCirclesCache(userId);

    return updatedCircle;
  }

  async getContributionProgress(
    circleId: string
  ): Promise<ContributionProgress> {
    const circle = await this.getCircleById(circleId);
    const activeMembers = circle.members.filter((m) => m.status === "ACTIVE");

    const contributedCount =
      await this.transactionRepository.countRoundContributions(
        circleId,
        circle.currentRound
      );

    const amountCollected =
      await this.transactionRepository.getRoundTotalContributed(
        circleId,
        circle.currentRound
      );

    const contributionAmount = parseFloat(
      circle.contributionSettings.amount || "0"
    );
    const targetAmount = activeMembers.length * contributionAmount;

    const deadline = this.calculateContributionDeadline(
      circle.startDate,
      circle.currentRound,
      circle.contributionSettings.frequency,
      circle.contributionSettings.gracePeriodDays
    );

    return {
      round: circle.currentRound,
      totalMembers: activeMembers.length,
      contributedCount,
      amountCollected,
      targetAmount: targetAmount.toString(),
      deadline,
    };
  }

  async getNextPayoutInfo(circleId: string): Promise<{
    nextPayoutDate: Date | null;
    nextRecipient: {
      userId: string;
      position: number;
    } | null;
    payoutAmount: string;
  }> {
    const circle = await this.getCircleById(circleId);

    if (circle.status !== CircleStatus.ACTIVE) {
      return {
        nextPayoutDate: null,
        nextRecipient: null,
        payoutAmount: "0",
      };
    }

    const nextRecipient = circle.members
      .filter((m) => m.status === "ACTIVE" && !m.hasReceivedPayout)
      .sort((a, b) => a.position - b.position)[0];

    const activeMembers = circle.members.filter((m) => m.status === "ACTIVE");
    const contributionAmount = parseFloat(
      circle.contributionSettings.amount || "0"
    );
    const payoutAmount = (activeMembers.length * contributionAmount).toString();

    return {
      nextPayoutDate: circle.nextPayoutDate || null,
      nextRecipient: nextRecipient
        ? {
            userId: nextRecipient.userId.toString(),
            position: nextRecipient.position,
          }
        : null,
      payoutAmount,
    };
  }

  async activateCircle(
    circleId: string,
    contractAddress: string
  ): Promise<CircleDocument> {
    const circle = await this.getCircleById(circleId);

    if (circle.status !== CircleStatus.PENDING) {
      throw new BadRequestException("Circle is not in pending status");
    }

    const isValidContract = await this.nearService.isValidCircleContract(
      contractAddress
    );

    if (!isValidContract) {
      throw new BadRequestException(
        "Invalid or inactive NEAR contract address"
      );
    }

    const updated = await this.circleRepository.setContractAddress(
      circleId,
      contractAddress
    );

    if (!updated) {
      throw new BadRequestException("Failed to activate circle");
    }

    this.logger.log(
      `Circle ${circleId} activated with contract ${contractAddress}`
    );

    await this.invalidateCircleCache(circleId);

    return updated;
  }

  private async generateUniqueInviteCode(): Promise<string> {
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const code = nanoid(APP_CONSTANTS.INVITE_CODE_LENGTH).toUpperCase();
      const exists = await this.circleRepository.inviteCodeExists(code);

      if (!exists) {
        return code;
      }

      attempts++;
    }

    // Fallback with timestamp to ensure uniqueness
    return `${nanoid(6).toUpperCase()}${Date.now().toString(36).toUpperCase()}`;
  }

  private calculateNextPayoutDate(
    startDate: Date,
    frequency: PayoutFrequency
  ): Date {
    const date = new Date(startDate);

    switch (frequency) {
      case PayoutFrequency.WEEKLY:
        date.setDate(date.getDate() + 7);
        break;
      case PayoutFrequency.BI_WEEKLY:
        date.setDate(date.getDate() + 14);
        break;
      case PayoutFrequency.MONTHLY:
      default:
        date.setMonth(date.getMonth() + 1);
        break;
    }

    return date;
  }

  private calculateContributionDeadline(
    startDate: Date,
    currentRound: number,
    frequency: PayoutFrequency,
    gracePeriodDays: number
  ): Date {
    const payoutDate = new Date(startDate);

    // Add time based on frequency and round
    switch (frequency) {
      case PayoutFrequency.WEEKLY:
        payoutDate.setDate(payoutDate.getDate() + 7 * (currentRound + 1));
        break;
      case PayoutFrequency.BI_WEEKLY:
        payoutDate.setDate(payoutDate.getDate() + 14 * (currentRound + 1));
        break;
      case PayoutFrequency.MONTHLY:
      default:
        payoutDate.setMonth(payoutDate.getMonth() + (currentRound + 1));
        break;
    }

    payoutDate.setDate(payoutDate.getDate() - gracePeriodDays);

    return payoutDate;
  }

  private async invalidateCircleCache(circleId: string): Promise<void> {
    await this.cacheManager.del(`${CACHE_KEYS.CIRCLE}:${circleId}`);
  }

  private async invalidateUserCirclesCache(userId: string): Promise<void> {
    await this.cacheManager.del(`${CACHE_KEYS.USER_CIRCLES}:${userId}`);
  }
}
