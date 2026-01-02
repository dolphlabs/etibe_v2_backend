import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
} from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { Types } from "mongoose";
import { nanoid } from "nanoid";
import { CircleRepository } from "../repositories/circle.repository";
import { TransactionRepository } from "../repositories/transaction.repository";
import { NearService } from "../../blockchain/services/near.service";
import { NearAccountService } from "../../blockchain/services/near-account.service";
import { CircleDocument, TransactionDocument } from "../schemas";
import {
  CreateCircleDto,
  JoinCircleDto,
  CircleDashboardDto,
  CircleStatsDto,
  NextRecipientDto,
  CircleMemberResponseDto,
  ActivityLogDto,
} from "../dto/circle.dto";
import {
  CircleStatus,
  TransactionType,
  TransactionStatus,
  PayoutFrequency,
  ContributionProgress,
} from "../../../shared/enums/circle.enums";
import {
  CACHE_KEYS,
  CACHE_TTL,
  APP_CONSTANTS,
} from "../../../shared/constants";
import { UserRepository } from "../../users/repositories";
import { CircleMailService } from "./circle-mail.service";

@Injectable()
export class CircleService {
  private readonly logger = new Logger(CircleService.name);

  constructor(
    private readonly circleRepository: CircleRepository,
    private readonly transactionRepository: TransactionRepository,
    private readonly userRepository: UserRepository,
    private readonly nearService: NearService,
    private readonly nearAccountService: NearAccountService,
    private readonly circleMailService: CircleMailService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache
  ) {}

  async createCircle(
    creatorId: string,
    dto: CreateCircleDto
  ): Promise<CircleDocument> {
    const creator = await this.userRepository.findById(creatorId);

    if (!creator?.nearAccountId) {
      throw new BadRequestException(
        "You need a verified NEAR account to create a circle"
      );
    }

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
      contributionSettings: {
        amount: dto.contributionSettings.amount,
        currency: dto.contributionSettings.currency,
        frequency: dto.contributionSettings.frequency,
        gracePeriodDays: dto.contributionSettings.gracePeriodDays ?? 3,
        penaltyPercentage: dto.contributionSettings.penaltyPercentage ?? "0",
      },
      maxMembers: dto.maxMembers,
      currentRound: 0,
      totalRounds,
      status: CircleStatus.PENDING,
      startDate,
      nextPayoutDate,
      inviteCode,
      inviteLink: `https://etibe.app/join/${inviteCode}`,
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

    // Send creation email to creator
    await this.circleMailService.sendCircleCreatedEmail(
      creator.email,
      creator.firstName,
      circle.name,
      circle.inviteCode,
      circle.inviteLink || ""
    );

    await this.invalidateUserCirclesCache(creatorId);

    return circle;
  }

  async activateCircle(
    circleId: string,
    userId: string
  ): Promise<{
    circle: CircleDocument;
    contractAddress: string;
    txHash: string;
  }> {
    const circle = await this.getCircleById(circleId);

    if (circle.creatorId.toString() !== userId) {
      throw new ForbiddenException("Only the circle creator can activate it");
    }

    if (circle.status !== CircleStatus.PENDING) {
      throw new BadRequestException(
        `Circle is in ${circle.status} status, cannot activate`
      );
    }

    const creator = await this.userRepository.findById(userId);
    if (!creator?.nearAccountId) {
      throw new BadRequestException(
        "Creator must have a NEAR account to activate the circle"
      );
    }

    this.logger.log(`Deploying circle contract for: ${circle.name}`);

    const { contractAddress, txHash } =
      await this.nearAccountService.deployCircleContract(
        circleId,
        circle.name,
        creator.nearAccountId,
        circle.contributionSettings.amount,
        circle.contributionSettings.currency,
        circle.contributionSettings.frequency,
        circle.maxMembers,
        circle.contributionSettings.gracePeriodDays
      );

    // Update circle with contract address and activate
    const updated = await this.circleRepository.update(circleId, {
      contractAddress,
      status: CircleStatus.RECRUITING,
    } as Partial<CircleDocument>);

    if (!updated) {
      throw new BadRequestException("Failed to activate circle");
    }

    this.logger.log(
      `Circle ${circleId} activated with contract ${contractAddress}, txHash: ${txHash}`
    );

    await this.invalidateCircleCache(circleId);

    return {
      circle: updated,
      contractAddress,
      txHash,
    };
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

  async getUserCircles(
    userId: string,
    status?: string
  ): Promise<CircleDocument[]> {
    const cacheKey = `${CACHE_KEYS.USER_CIRCLES}:${userId}:${status || "all"}`;
    const cached = await this.cacheManager.get<CircleDocument[]>(cacheKey);

    if (cached) {
      return cached;
    }

    let circles = await this.circleRepository.findUserCircles(userId);

    if (status) {
      circles = circles.filter((c) => c.status === status);
    }

    await this.cacheManager.set(cacheKey, circles, CACHE_TTL.SHORT * 1000);

    return circles;
  }

  async getCircleDashboard(
    circleId: string,
    userId: string
  ): Promise<CircleDashboardDto> {
    const circle = await this.getCircleById(circleId);
    const activeMembers = circle.members.filter((m) => m.status === "ACTIVE");

    // Get member details
    const memberDetails = await this.getMemberDetails(activeMembers);

    // Calculate stats
    const contributionAmount = parseFloat(
      circle.contributionSettings.amount || "0"
    );
    const targetAmount = activeMembers.length * contributionAmount;
    const collected = parseFloat(circle.totalContributed || "0");

    const stats: CircleStatsDto = {
      collected: collected.toString(),
      target: targetAmount.toString(),
      progress:
        targetAmount > 0 ? Math.round((collected / targetAmount) * 100) : 0,
      membersContributed:
        await this.transactionRepository.countRoundContributions(
          circleId,
          circle.currentRound
        ),
      totalMembers: activeMembers.length,
    };

    // Find next recipient
    const nextRecipientMember = activeMembers
      .filter((m) => !m.hasReceivedPayout)
      .sort((a, b) => a.position - b.position)[0];

    let nextRecipient: NextRecipientDto | null = null;
    if (nextRecipientMember) {
      const memberUser = memberDetails.find(
        (m) => m.userId === nextRecipientMember.userId.toString()
      );
      if (memberUser) {
        nextRecipient = {
          userId: memberUser.userId,
          username: memberUser.username,
          firstName: memberUser.firstName,
          lastName: memberUser.lastName,
          avatar: memberUser.avatar,
          position: nextRecipientMember.position,
        };
      }
    }

    // Calculate days until next contribution
    const daysUntilNextContribution = this.calculateDaysUntilDeadline(
      circle.startDate,
      circle.currentRound,
      circle.contributionSettings.frequency,
      circle.contributionSettings.gracePeriodDays
    );

    // Get recent activity
    const recentActivity = await this.getRecentActivity(circleId);

    // Check if user contributed this round
    const userContributedThisRound =
      await this.transactionRepository.hasUserContributedThisRound(
        userId,
        circleId,
        circle.currentRound
      );

    // Map payout order
    const payoutOrder: CircleMemberResponseDto[] = memberDetails
      .sort((a, b) => a.position - b.position)
      .map((m) => ({
        ...m,
        hasReceivedPayout:
          activeMembers.find((am) => am.userId.toString() === m.userId)
            ?.hasReceivedPayout || false,
        payoutDate: activeMembers.find(
          (am) => am.userId.toString() === m.userId
        )?.payoutDate,
        joinedAt:
          activeMembers.find((am) => am.userId.toString() === m.userId)
            ?.joinedAt || new Date(),
        status: "ACTIVE",
      }));

    return {
      circle: {
        id: circle._id.toString(),
        name: circle.name,
        description: circle.description,
        logoUrl: circle.logoUrl,
        status: circle.status,
        contractAddress: circle.contractAddress,
        contributionSettings: {
          amount: circle.contributionSettings.amount,
          currency: circle.contributionSettings.currency,
          frequency: circle.contributionSettings.frequency,
          gracePeriodDays: circle.contributionSettings.gracePeriodDays,
          penaltyPercentage: circle.contributionSettings.penaltyPercentage,
        },
        memberCount: activeMembers.length,
        maxMembers: circle.maxMembers,
        currentRound: circle.currentRound,
        totalRounds: circle.totalRounds,
        startDate: circle.startDate,
        nextPayoutDate: circle.nextPayoutDate,
        payoutAmount: targetAmount.toString(),
        inviteCode: circle.inviteCode,
        inviteLink: circle.inviteLink,
        isPrivate: circle.isPrivate,
        isFull: activeMembers.length >= circle.maxMembers,
        createdAt: circle.createdAt,
      },
      stats,
      nextRecipient,
      daysUntilNextContribution,
      payoutOrder,
      recentActivity,
      userContributedThisRound,
    };
  }

  async joinCircle(
    userId: string,
    userNearAccountId: string,
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

      // Verify user is whitelisted on the NEAR contract
      if (userNearAccountId) {
        const isWhitelisted = await this.nearService.isUserWhitelisted(
          dto.channelAddress,
          userNearAccountId
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

    // Send notification emails
    const newMember = await this.userRepository.findById(userId);
    if (newMember) {
      // Notify all existing members
      for (const member of activeMembers) {
        const memberUser = await this.userRepository.findById(
          member.userId.toString()
        );
        if (memberUser) {
          await this.circleMailService.sendMemberJoinedEmail(
            memberUser.email,
            memberUser.firstName,
            circle.name,
            newMember.firstName,
            newMember.lastName
          );
        }
      }
    }

    this.logger.log(`User ${userId} joined circle ${circle.name}`);

    await this.invalidateCircleCache(circle._id.toString());
    await this.invalidateUserCirclesCache(userId);

    return updatedCircle;
  }

  async makeContribution(
    circleId: string,
    userId: string
  ): Promise<TransactionDocument> {
    const circle = await this.getCircleById(circleId);

    if (
      circle.status !== CircleStatus.ACTIVE &&
      circle.status !== CircleStatus.RECRUITING
    ) {
      throw new BadRequestException("Circle is not accepting contributions");
    }

    const user = await this.userRepository.findById(userId, {
      select: ["+nearEncryptedPrivateKey"],
    });

    if (!user?.nearAccountId) {
      throw new BadRequestException("You need a NEAR wallet to contribute");
    }

    if (!user.nearEncryptedPrivateKey) {
      throw new BadRequestException(
        "Your wallet is not set up for automatic contributions. Please contact support."
      );
    }

    const isMember = circle.members.some(
      (m) => m.userId.toString() === userId && m.status === "ACTIVE"
    );
    if (!isMember) {
      throw new BadRequestException("You must be a member to contribute");
    }

    const alreadyContributed =
      await this.transactionRepository.hasUserContributedThisRound(
        userId,
        circleId,
        circle.currentRound
      );
    if (alreadyContributed) {
      throw new ConflictException("You have already contributed this round");
    }

    const amount = circle.contributionSettings.amount;
    const currency = circle.contributionSettings.currency;

    if (!circle.contractAddress) {
      throw new BadRequestException(
        "Circle contract not deployed. Please activate the circle first."
      );
    }

    this.logger.log(
      `Executing contribution: ${amount} ${currency} from ${user.nearAccountId} for circle ${circle.name}`
    );

    // Execute the actual blockchain transfer
    const { txHash } = await this.nearAccountService.executeContribution(
      user.nearAccountId,
      user.nearEncryptedPrivateKey,
      circle.contractAddress,
      amount,
      currency
    );

    // Create transaction record
    const transaction = await this.transactionRepository.create({
      type: TransactionType.CONTRIBUTION,
      status: TransactionStatus.CONFIRMED,
      userId: new Types.ObjectId(userId),
      circleId: new Types.ObjectId(circleId),
      amount,
      currency,
      round: circle.currentRound,
      transactionHash: txHash,
      nearAccountId: user.nearAccountId,
      confirmedAt: new Date(),
    } as Partial<TransactionDocument>);

    // Update circle total contributed
    await this.circleRepository.incrementTotalContributed(circleId, amount);

    // Send contribution email
    await this.circleMailService.sendContributionReceivedEmail(
      user.email,
      user.firstName,
      circle.name,
      amount,
      currency,
      circle.currentRound
    );

    this.logger.log(
      `Contribution completed: ${amount} ${currency} to ${circle.name} by ${user.firstName}, txHash: ${txHash}`
    );

    await this.invalidateCircleCache(circleId);

    return transaction;
  }

  /**
   * @deprecated Use makeContribution instead - this method requires manual transaction submission
   */
  async recordContribution(
    circleId: string,
    userId: string,
    nearAccountId: string,
    transactionHash: string,
    amount: string
  ): Promise<TransactionDocument> {
    const circle = await this.getCircleById(circleId);

    if (circle.status !== CircleStatus.ACTIVE) {
      throw new BadRequestException("Circle is not active");
    }

    // Check for duplicate transaction hash
    const existing = await this.transactionRepository.findByHash(
      transactionHash
    );
    if (existing) {
      throw new ConflictException("Transaction already recorded");
    }

    // Verify the transaction on NEAR
    const verification = await this.nearService.verifyContribution(
      transactionHash,
      circle.contractAddress!,
      amount
    );

    if (!verification.isValid) {
      throw new BadRequestException("Invalid or failed transaction");
    }

    // Create transaction record
    const transaction = await this.transactionRepository.create({
      type: TransactionType.CONTRIBUTION,
      status: TransactionStatus.CONFIRMED,
      userId: new Types.ObjectId(userId),
      circleId: new Types.ObjectId(circleId),
      amount,
      currency: circle.contributionSettings.currency,
      round: circle.currentRound,
      transactionHash,
      nearAccountId,
      confirmedAt: new Date(),
    } as Partial<TransactionDocument>);

    // Update circle total contributed
    await this.circleRepository.incrementTotalContributed(circleId, amount);

    // Send contribution email
    const contributor = await this.userRepository.findById(userId);
    if (contributor) {
      await this.circleMailService.sendContributionReceivedEmail(
        contributor.email,
        contributor.firstName,
        circle.name,
        amount,
        circle.contributionSettings.currency,
        circle.currentRound
      );
    }

    this.logger.log(
      `Contribution recorded: ${amount} ${circle.contributionSettings.currency} to ${circle.name}`
    );

    await this.invalidateCircleCache(circleId);

    return transaction;
  }

  async inviteMember(
    circleId: string,
    inviterId: string,
    inviteeEmail?: string,
    inviteeUserId?: string
  ): Promise<{ inviteCode: string }> {
    const circle = await this.getCircleById(circleId);

    // Verify inviter is a member
    const isMember = circle.members.some(
      (m) => m.userId.toString() === inviterId && m.status === "ACTIVE"
    );

    if (!isMember) {
      throw new ForbiddenException("You must be a member to invite others");
    }

    const inviter = await this.userRepository.findById(inviterId);

    if (inviteeEmail && inviter) {
      await this.circleMailService.sendCircleInvitationEmail(
        inviteeEmail,
        inviter.firstName,
        inviter.lastName,
        circle.name,
        circle.inviteCode,
        circle.inviteLink || ""
      );
    }

    return { inviteCode: circle.inviteCode };
  }

  async discoverCircles(filters: {
    currency?: string;
    minAmount?: string;
    maxAmount?: string;
  }): Promise<CircleDocument[]> {
    // Get public recruiting circles
    const circles = await this.circleRepository.findAll({
      isPrivate: false,
      status: CircleStatus.RECRUITING,
    } as any);

    let filtered = circles;

    if (filters.currency) {
      filtered = filtered.filter(
        (c) => c.contributionSettings.currency === filters.currency
      );
    }

    if (filters.minAmount) {
      const min = parseFloat(filters.minAmount);
      filtered = filtered.filter(
        (c) => parseFloat(c.contributionSettings.amount) >= min
      );
    }

    if (filters.maxAmount) {
      const max = parseFloat(filters.maxAmount);
      filtered = filtered.filter(
        (c) => parseFloat(c.contributionSettings.amount) <= max
      );
    }

    return filtered;
  }

  async getContributionProgress(
    circleId: string
  ): Promise<ContributionProgress & { percentage: number }> {
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

    const percentage =
      targetAmount > 0
        ? Math.round((parseFloat(amountCollected) / targetAmount) * 100)
        : 0;

    return {
      round: circle.currentRound,
      totalMembers: activeMembers.length,
      contributedCount,
      amountCollected,
      targetAmount: targetAmount.toString(),
      deadline,
      percentage,
    };
  }

  async getNextPayoutInfo(circleId: string): Promise<{
    nextPayoutDate: Date | null;
    nextRecipient: { userId: string; position: number } | null;
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

  private async getMemberDetails(
    members: any[]
  ): Promise<CircleMemberResponseDto[]> {
    const details: CircleMemberResponseDto[] = [];

    for (const member of members) {
      const user = await this.userRepository.findById(member.userId.toString());
      if (user) {
        details.push({
          userId: user._id.toString(),
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          avatar: user.avatar,
          position: member.position,
          hasReceivedPayout: member.hasReceivedPayout,
          payoutDate: member.payoutDate,
          joinedAt: member.joinedAt,
          status: member.status,
        });
      }
    }

    return details;
  }

  private async getRecentActivity(circleId: string): Promise<ActivityLogDto[]> {
    const transactions = await this.transactionRepository.findAll(
      {
        circleId: new Types.ObjectId(circleId),
        status: TransactionStatus.CONFIRMED,
      } as any,
      { sort: { createdAt: -1 } }
    );

    const activities: ActivityLogDto[] = [];

    for (const tx of transactions.slice(0, 10)) {
      const user = await this.userRepository.findById(tx.userId.toString());
      activities.push({
        type: tx.type,
        userId: tx.userId.toString(),
        username: user?.username,
        amount: tx.amount,
        message: this.formatActivityMessage(
          tx.type,
          user?.firstName || "Member"
        ),
        timestamp: tx.createdAt,
      });
    }

    return activities;
  }

  private formatActivityMessage(type: TransactionType, name: string): string {
    switch (type) {
      case TransactionType.CONTRIBUTION:
        return `${name} made a contribution`;
      case TransactionType.PAYOUT:
        return `${name} received payout`;
      default:
        return `${name} performed an action`;
    }
  }

  private calculateDaysUntilDeadline(
    startDate: Date,
    currentRound: number,
    frequency: PayoutFrequency,
    gracePeriodDays: number
  ): number {
    const deadline = this.calculateContributionDeadline(
      startDate,
      currentRound,
      frequency,
      gracePeriodDays
    );
    const now = new Date();
    const diffMs = deadline.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
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
    await this.cacheManager.del(`${CACHE_KEYS.USER_CIRCLES}:${userId}:all`);
  }
}
