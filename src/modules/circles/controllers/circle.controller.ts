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
  NotFoundException,
} from "@nestjs/common";
import { CircleService } from "../services/circle.service";
import {
  CreateCircleDto,
  ActivateCircleDto,
  JoinCircleDto,
  RecordContributionDto,
  InviteMemberDto,
  InitiateCircleResponseDto,
  CircleDashboardDto,
  ContributionProgressDto,
  PayoutInfoDto,
  CircleResponseDto,
} from "../dto/circle.dto";
import { VerifiedUserGuard } from "../guards/verified-user.guard";
import { CurrentUser, CurrentUserId } from "../../auth/decorators";
import { AuthenticatedUser } from "../../../shared/types/session.types";
import { ConfigService } from "@nestjs/config";

@Controller("circles")
@UseGuards(VerifiedUserGuard)
export class CircleController {
  private readonly logger = new Logger(CircleController.name);
  private readonly factoryContractId: string;

  constructor(
    private readonly circleService: CircleService,
    private readonly configService: ConfigService
  ) {
    this.factoryContractId = this.configService.get<string>(
      "near.factoryContractId",
      "factory.etibe.testnet"
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async initiateCircle(
    @Body() dto: CreateCircleDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ data: InitiateCircleResponseDto; message: string }> {
    if (!user.nearAccountId) {
      throw new BadRequestException("NEAR wallet required to create a circle");
    }

    const circle = await this.circleService.createCircle(user.id, dto);

    const initArgs = {
      name: circle.name,
      contribution_amount: circle.contributionSettings.amount,
      currency: circle.contributionSettings.currency,
      frequency: circle.contributionSettings.frequency,
      max_members: circle.maxMembers,
      grace_period_days: circle.contributionSettings.gracePeriodDays,
    };

    this.logger.log(`Circle initiated: ${circle._id} by ${user.id}`);

    return {
      message: "Circle initiated. Deploy the contract on NEAR to activate.",
      data: {
        circleId: circle._id.toString(),
        inviteCode: circle.inviteCode,
        creatorNearAccountId: user.nearAccountId,
        factoryContractId: this.factoryContractId,
        initArgs,
      },
    };
  }

  @Patch(":id/activate")
  @HttpCode(HttpStatus.OK)
  async activateCircle(
    @Param("id") circleId: string,
    @Body() dto: ActivateCircleDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ data: CircleResponseDto; message: string }> {
    const circle = await this.circleService.activateCircle(
      circleId,
      dto.contractAddress,
      user.id
    );

    this.logger.log(
      `Circle ${circleId} activated with contract ${dto.contractAddress}`
    );

    return {
      message: "Circle activated successfully. Members can now join!",
      data: this.mapCircleToResponse(circle),
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

  @Post(":id/contributions")
  @HttpCode(HttpStatus.OK)
  async recordContribution(
    @Param("id") circleId: string,
    @Body() dto: RecordContributionDto,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ message: string; transactionId: string }> {
    const transaction = await this.circleService.recordContribution(
      circleId,
      user.id,
      user.nearAccountId || "",
      dto.transactionHash,
      dto.amount
    );

    return {
      message: "Contribution recorded successfully",
      transactionId: transaction._id.toString(),
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
      status: circle.status,
      contractAddress: circle.contractAddress,
      contributionSettings: {
        amount: circle.contributionSettings?.amount || "0",
        currency: circle.contributionSettings?.currency || "USDT",
        frequency: circle.contributionSettings?.frequency || "MONTHLY",
        gracePeriodDays: circle.contributionSettings?.gracePeriodDays || 3,
        penaltyPercentage:
          circle.contributionSettings?.penaltyPercentage || "0",
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
