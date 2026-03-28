import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
  BadRequestException,
} from "@nestjs/common";
import { CircleService } from "../services/circle.service";
import {
  CreateCircleDto,
  JoinCircleDto,
  InviteMemberDto,
  CircleDashboardDto,
  ContributionProgressDto,
  PayoutInfoDto,
  CircleResponseDto,
} from "../dto/circle.dto";
import { VerifiedUserGuard } from "../guards/verified-user.guard";
import { CurrentUser, CurrentUserId } from "../../auth/decorators";
import { AuthenticatedUser } from "../../../shared/types/session.types";

@Controller("circles")
@UseGuards(VerifiedUserGuard)
export class CircleController {
  private readonly logger = new Logger(CircleController.name);

  constructor(private readonly circleService: CircleService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createCircle(
    @Body() dto: CreateCircleDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ data: CircleResponseDto; message: string }> {
    if (!user.nearAccountId) {
      throw new BadRequestException("NEAR wallet required to create a circle");
    }

    const circle = await this.circleService.createCircle(user.id, dto);

    this.logger.log(`Circle created: ${circle._id} by ${user.id}`);

    return {
      message:
        "Circle created successfully. Activate it when you're ready to start!",
      data: this.mapCircleToResponse(circle),
    };
  }

  @Post(":id/activate")
  @HttpCode(HttpStatus.OK)
  async activateCircle(
    @Param("id") circleId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{
    data: CircleResponseDto;
    contractAddress: string;
    message: string;
  }> {
    const result = await this.circleService.activateCircle(circleId, user.id);

    this.logger.log(
      `Circle ${circleId} activated with contract ${result.contractAddress}`
    );

    return {
      message:
        "Circle activated successfully! Members can now join using your invite code.",
      data: this.mapCircleToResponse(result.circle),
      contractAddress: result.contractAddress,
    };
  }

  @Get(":id/dashboard")
  async getCircleDashboard(
    @Param("id") circleId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ data: CircleDashboardDto }> {
    const dashboard = await this.circleService.getCircleDashboard(
      circleId,
      user.id
    );

    return { data: dashboard };
  }

  @Get(":id")
  async getCircle(
    @Param("id") circleId: string
  ): Promise<{ data: CircleResponseDto }> {
    const circle = await this.circleService.getCircleById(circleId);

    return { data: this.mapCircleToResponse(circle) };
  }

  @Get()
  async getUserCircles(
    @CurrentUserId() userId: string,
    @Query("status") status?: string
  ): Promise<{ data: CircleResponseDto[] }> {
    const circles = await this.circleService.getUserCircles(userId, status);

    return { data: circles.map((c) => this.mapCircleToResponse(c)) };
  }

  @Post("join")
  @HttpCode(HttpStatus.OK)
  async joinCircle(
    @Body() dto: JoinCircleDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ data: CircleResponseDto; message: string }> {
    if (!dto.inviteCode && !dto.channelAddress) {
      throw new BadRequestException(
        "Either invite code or channel address is required"
      );
    }

    const circle = await this.circleService.joinCircle(
      user.id,
      user.nearAccountId || "",
      dto
    );

    return {
      message: "Successfully joined the circle!",
      data: this.mapCircleToResponse(circle),
    };
  }

  @Get(":id/progress")
  async getContributionProgress(
    @Param("id") circleId: string
  ): Promise<{ data: ContributionProgressDto }> {
    const progress = await this.circleService.getContributionProgress(circleId);

    return { data: progress };
  }

  @Get(":id/payout-info")
  async getPayoutInfo(
    @Param("id") circleId: string
  ): Promise<{ data: PayoutInfoDto }> {
    const payoutInfo = await this.circleService.getNextPayoutInfo(circleId);

    return { data: payoutInfo };
  }

  @Post(":id/contribute")
  @HttpCode(HttpStatus.OK)
  async contribute(
    @Param("id") circleId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ message: string; transactionId: string; amount: string }> {
    const transaction = await this.circleService.makeContribution(
      circleId,
      user.id
    );

    return {
      message: "Contribution successful! Thank you for contributing.",
      transactionId: transaction._id.toString(),
      amount: transaction.amount,
    };
  }

  @Post(":id/invite")
  @HttpCode(HttpStatus.OK)
  async inviteMember(
    @Param("id") circleId: string,
    @Body() dto: InviteMemberDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ message: string; inviteCode: string }> {
    const result = await this.circleService.inviteMember(
      circleId,
      user.id,
      dto.inviteeEmail,
      dto.inviteeUserId
    );

    return {
      message: "Invitation sent successfully",
      inviteCode: result.inviteCode,
    };
  }

  @Get("discover")
  async discoverCircles(
    @Query("currency") currency?: string,
    @Query("minAmount") minAmount?: string,
    @Query("maxAmount") maxAmount?: string
  ): Promise<{ data: CircleResponseDto[] }> {
    const circles = await this.circleService.discoverCircles({
      currency,
      minAmount,
      maxAmount,
    });

    return { data: circles.map((c) => this.mapCircleToResponse(c)) };
  }

  @Get("invite/:code")
  async getCircleByInviteCode(
    @Param("code") inviteCode: string
  ): Promise<{ data: CircleResponseDto }> {
    const circle = await this.circleService.getCircleByInviteCode(inviteCode);

    return { data: this.mapCircleToResponse(circle) };
  }

  @Post(":id/start")
  @HttpCode(HttpStatus.OK)
  async startCircle(
    @Param("id") circleId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{
    data: CircleResponseDto;
    payoutsScheduled: boolean;
    message: string;
  }> {
    const result = await this.circleService.startCircle(circleId, user.id);

    this.logger.log(
      `Circle ${circleId} started by ${user.id}, payouts scheduled: ${result.payoutsScheduled}`
    );

    return {
      message:
        "Circle is now ACTIVE! Automated payouts have been scheduled for all members.",
      data: this.mapCircleToResponse(result.circle),
      payoutsScheduled: result.payoutsScheduled,
    };
  }

  @Get(":id/payout-schedule")
  async getPayoutSchedule(@Param("id") circleId: string): Promise<{
    data: {
      circleId: string;
      circleName: string;
      status: string;
      currentRound: number;
      totalRounds: number;
      payoutSchedule: {
        round: number;
        recipientUserId: string;
        recipientName: string;
        estimatedPayoutDate: Date;
        hasReceived: boolean;
        payoutDate?: Date;
        transactionHash?: string;
      }[];
    };
  }> {
    const schedule = await this.circleService.getPayoutSchedule(circleId);

    return { data: schedule };
  }

  private mapCircleToResponse(circle: any): CircleResponseDto {
    const activeMembers =
      circle.members?.filter((m: any) => m.status === "ACTIVE") || [];
    const contributionAmount = parseFloat(
      circle.contributionSettings?.amount || "0"
    );

    return {
      id: circle._id.toString(),
      name: circle.name,
      description: circle.description,
      logoUrl: circle.logoUrl,
      chain: circle.chain || "NEAR",
      status: circle.status,
      contractAddress: circle.contractAddress,
      contributionSettings: {
        amount: circle.contributionSettings?.amount.toString() || "0",
        currency: circle.contributionSettings?.currency || "USDT",
        frequency: circle.contributionSettings?.frequency || "MONTHLY",
        gracePeriodDays: circle.contributionSettings?.gracePeriodDays || 3,
        penaltyPercentage:
          circle.contributionSettings?.penaltyPercentage.toString() || "0",
      },
      memberCount: activeMembers.length,
      maxMembers: circle.maxMembers,
      currentRound: circle.currentRound,
      totalRounds: circle.totalRounds,
      startDate: circle.startDate,
      nextPayoutDate: circle.nextPayoutDate,
      payoutAmount: (activeMembers.length * contributionAmount).toString(),
      inviteCode: circle.inviteCode,
      inviteLink: circle.inviteLink,
      isPrivate: circle.isPrivate,
      isFull: activeMembers.length >= circle.maxMembers,
      createdAt: circle.createdAt,
    };
  }
}
