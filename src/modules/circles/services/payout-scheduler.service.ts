import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { CircleRepository } from "../repositories/circle.repository";
import { UserRepository } from "../../users/repositories/user.repository";
import { CircleDocument } from "../schemas/circle.schema";
import {
  PayoutFrequency,
  CircleStatus,
  Currency,
  Chain,
} from "../../../shared/enums/circle.enums";
import {
  PAYOUT_QUEUE_NAME,
  PayoutJobData,
  PayoutJobType,
  generatePayoutJobId,
  PAYOUT_JOB_OPTIONS,
} from "../constants/payout.constants";
import { NotificationService } from "../../notifications/services/notification.service";
import { NotificationType } from "../../../shared/enums";
import { Types } from "mongoose";

@Injectable()
export class PayoutSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(PayoutSchedulerService.name);

  constructor(
    @InjectQueue(PAYOUT_QUEUE_NAME)
    private readonly payoutQueue: Queue<PayoutJobData>,
    private readonly circleRepository: CircleRepository,
    private readonly userRepository: UserRepository,
    private readonly notificationService: NotificationService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log("PayoutSchedulerService initialized");

    // On startup, check for any active circles that might need their jobs re-scheduled
    // This handles cases where the server restarts while jobs were pending
    await this.reconcilePendingPayouts();
  }

  async scheduleCirclePayouts(circle: CircleDocument): Promise<{
    scheduledPayouts: number;
    payoutDates: Date[];
  }> {
    this.logger.log(
      `Scheduling payouts for circle: ${circle._id}, status: ${circle.status}`,
    );

    const activeMembers = circle.members.filter((m) => m.status === "ACTIVE");
    if (activeMembers.length === 0) {
      this.logger.warn(
        `Circle ${circle._id} has no active members, skipping payout scheduling`,
      );
      return { scheduledPayouts: 0, payoutDates: [] };
    }

    const sortedMembers = [...activeMembers].sort(
      (a, b) => a.position - b.position,
    );

    const totalRounds = sortedMembers.length;

    const payoutDates = this.calculateAllPayoutDates(
      circle.startDate,
      circle.contributionSettings.frequency,
      totalRounds,
    );

    const contributionAmount = parseFloat(
      circle.contributionSettings.amount || "0",
    );
    const payoutAmount = (contributionAmount * activeMembers.length).toString();

    const scheduledJobs: string[] = [];

    for (let round = 1; round <= totalRounds; round++) {
      const payoutDate = payoutDates[round - 1];
      const recipient = sortedMembers[round - 1];

      const recipientUser = await this.userRepository.findById(
        recipient.userId.toString(),
      );

      const chain = circle.chain || Chain.NEAR;

      if (!recipientUser) {
        this.logger.error(
          `User ${recipient.userId} not found, cannot schedule payout for round ${round}`,
        );
        continue;
      }
      if (chain === Chain.NEAR && !recipientUser.nearAccountId) {
        this.logger.error(
          `User ${recipient.userId} does not have a NEAR account, cannot schedule payout for round ${round}`,
        );
        continue;
      }
      if (chain === Chain.BASE && !recipientUser.baseAddress) {
        this.logger.error(
          `User ${recipient.userId} does not have a Base account, cannot schedule payout for round ${round}`,
        );
        continue;
      }

      const jobId = generatePayoutJobId(circle._id.toString(), round);
      const delay = Math.max(0, payoutDate.getTime() - Date.now());

      const jobData: PayoutJobData = {
        circleId: circle._id.toString(),
        roundNumber: round,
        recipientUserId: recipient.userId.toString(),
        recipientNearAccountId:
          chain === Chain.NEAR ? recipientUser.nearAccountId : undefined,
        recipientBaseAddress:
          chain === Chain.BASE ? recipientUser.baseAddress : undefined,
        chain,
        payoutAmount,
        currency: circle.contributionSettings.currency,
        scheduledPayoutDate: payoutDate.toISOString(),
        contractAddress: circle.contractAddress || "",
        retryCount: 0,
      };

      try {
        const existingJob = await this.payoutQueue.getJob(jobId);
        if (existingJob) {
          this.logger.debug(`Job ${jobId} already exists, skipping`);
          continue;
        }

        await this.payoutQueue.add(PayoutJobType.SCHEDULED_PAYOUT, jobData, {
          ...PAYOUT_JOB_OPTIONS,
          jobId,
          delay,
          priority: round, // Lower round = higher priority
        });

        scheduledJobs.push(jobId);
        this.logger.log(
          `Scheduled payout job ${jobId} for ${payoutDate.toISOString()}, recipient: ${
            recipientUser.nearAccountId
          }, amount: ${payoutAmount} ${circle.contributionSettings.currency}`,
        );

        // Notify user
        await this.notificationService.createNotification({
          userId: recipientUser._id,
          title: "Payout Scheduled",
          content: `Your payout of ${payoutAmount} ${circle.contributionSettings.currency} from ${circle.name} has been scheduled for ${payoutDate.toLocaleDateString()}.`,
          type: NotificationType.PAYOUT_SCHEDULED,
          metadata: {
            circleId: circle._id,
            round,
            scheduledDate: payoutDate,
          },
        });
      } catch (error) {
        this.logger.error(`Failed to schedule payout job ${jobId}:`, error);
      }
    }

    if (payoutDates.length > 0) {
      await this.circleRepository.update(circle._id.toString(), {
        nextPayoutDate: payoutDates[0],
        totalRounds,
      } as Partial<CircleDocument>);
    }

    this.logger.log(
      `Scheduled ${scheduledJobs.length}/${totalRounds} payouts for circle ${circle._id}`,
    );

    return {
      scheduledPayouts: scheduledJobs.length,
      payoutDates,
    };
  }

  private calculateAllPayoutDates(
    startDate: Date,
    frequency: PayoutFrequency,
    totalRounds: number,
  ): Date[] {
    const dates: Date[] = [];
    let currentDate = new Date(startDate);

    for (let i = 0; i < totalRounds; i++) {
      currentDate = this.addFrequencyPeriod(currentDate, frequency);
      dates.push(new Date(currentDate));
    }

    return dates;
  }

  private addFrequencyPeriod(date: Date, frequency: PayoutFrequency): Date {
    const newDate = new Date(date);

    switch (frequency) {
      case PayoutFrequency.WEEKLY:
        newDate.setDate(newDate.getDate() + 7);
        break;
      case PayoutFrequency.BI_WEEKLY:
        newDate.setDate(newDate.getDate() + 14);
        break;
      case PayoutFrequency.MONTHLY:
      default:
        newDate.setMonth(newDate.getMonth() + 1);
        break;
    }

    return newDate;
  }

  async cancelCirclePayouts(circleId: string): Promise<number> {
    this.logger.log(`Cancelling all payouts for circle: ${circleId}`);

    let cancelledCount = 0;
    const delayedJobs = await this.payoutQueue.getDelayed();
    const waitingJobs = await this.payoutQueue.getWaiting();
    const allJobs = [...delayedJobs, ...waitingJobs];

    for (const job of allJobs) {
      if (job.data.circleId === circleId) {
        try {
          await job.remove();
          cancelledCount++;
          this.logger.debug(`Cancelled payout job: ${job.id}`);
        } catch (error) {
          this.logger.error(`Failed to cancel job ${job.id}:`, error);
        }
      }
    }

    this.logger.log(
      `Cancelled ${cancelledCount} payout jobs for circle ${circleId}`,
    );
    return cancelledCount;
  }

  async getCirclePayoutSchedule(circleId: string): Promise<
    {
      jobId: string;
      roundNumber: number;
      scheduledDate: string;
      recipientUserId: string;
      amount: string;
      currency: string;
      status: string;
    }[]
  > {
    const delayedJobs = await this.payoutQueue.getDelayed();
    const waitingJobs = await this.payoutQueue.getWaiting();
    const activeJobs = await this.payoutQueue.getActive();
    const completedJobs = await this.payoutQueue.getCompleted();

    const allJobs = [
      ...delayedJobs,
      ...waitingJobs,
      ...activeJobs,
      ...completedJobs,
    ];

    return allJobs
      .filter((job) => job.data.circleId === circleId)
      .map((job) => ({
        jobId: job.id || "",
        roundNumber: job.data.roundNumber,
        scheduledDate: job.data.scheduledPayoutDate,
        recipientUserId: job.data.recipientUserId,
        amount: job.data.payoutAmount,
        currency: job.data.currency,
        status: this.getJobStatus(job),
      }))
      .sort((a, b) => a.roundNumber - b.roundNumber);
  }

  private getJobStatus(job: any): string {
    if (job.finishedOn) return "COMPLETED";
    if (job.processedOn) return "PROCESSING";
    if (job.delay && job.delay > 0) return "SCHEDULED";
    return "WAITING";
  }

  private async reconcilePendingPayouts(): Promise<void> {
    this.logger.log("Reconciling pending payouts...");

    try {
      const activeCircles = await this.circleRepository.findAll({
        status: CircleStatus.ACTIVE,
        deletedAt: null,
      } as any);

      for (const circle of activeCircles) {
        const existingJobs = await this.getCirclePayoutSchedule(
          circle._id.toString(),
        );
        const pendingRounds = circle.members
          .filter((m) => m.status === "ACTIVE" && !m.hasReceivedPayout)
          .map((m) => m.position);

        const scheduledRounds = existingJobs.map((j) => j.roundNumber);
        const missingRounds = pendingRounds.filter(
          (r) => !scheduledRounds.includes(r),
        );

        if (missingRounds.length > 0) {
          this.logger.warn(
            `Circle ${circle._id} has ${missingRounds.length} missing payout jobs, rescheduling...`,
          );
          await this.scheduleCirclePayouts(circle);
        }
      }

      this.logger.log("Payout reconciliation complete");
    } catch (error) {
      this.logger.error("Failed to reconcile pending payouts:", error);
    }
  }

  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.payoutQueue.getWaitingCount(),
      this.payoutQueue.getActiveCount(),
      this.payoutQueue.getCompletedCount(),
      this.payoutQueue.getFailedCount(),
      this.payoutQueue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }
}
