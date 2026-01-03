import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { PayoutSchedulerService } from "../services/payout-scheduler.service";
import { CircleRepository } from "../repositories/circle.repository";
import { CircleDocument } from "../schemas/circle.schema";
import { CIRCLE_EVENTS } from "../constants/payout.constants";
import { CircleStatus } from "../../../shared/enums/circle.enums";

@Injectable()
export class CircleActivatedListener {
  private readonly logger = new Logger(CircleActivatedListener.name);

  constructor(
    private readonly payoutSchedulerService: PayoutSchedulerService,
    private readonly circleRepository: CircleRepository
  ) {}

  @OnEvent(CIRCLE_EVENTS.CIRCLE_ACTIVATED, { async: true })
  async handleCircleActivated(payload: {
    circleId: string;
    activatedBy: string;
    activatedAt: string;
    contractAddress?: string;
  }): Promise<void> {
    const { circleId, activatedBy, activatedAt, contractAddress } = payload;

    this.logger.log(
      `[CIRCLE_ACTIVATED] Circle ${circleId} activated by ${activatedBy} at ${activatedAt}`
    );

    try {
      const circle = await this.circleRepository.findById(circleId);
      if (!circle) {
        this.logger.error(`Circle ${circleId} not found`);
        return;
      }

      if (circle.status !== CircleStatus.ACTIVE) {
        this.logger.warn(
          `Circle ${circleId} is not ACTIVE (status: ${circle.status}), skipping payout scheduling`
        );
        return;
      }

      if (!circle.contractAddress && !contractAddress) {
        this.logger.error(
          `Circle ${circleId} has no contract address, cannot schedule payouts`
        );
        return;
      }

      const result = await this.payoutSchedulerService.scheduleCirclePayouts(
        circle
      );

      this.logger.log(
        `[PAYOUT_SCHEDULED] ${result.scheduledPayouts} payouts scheduled for circle ${circleId}`
      );

      if (result.payoutDates.length > 0) {
        this.logger.debug(
          `Payout schedule for circle ${circleId}:\n${result.payoutDates
            .map((date, idx) => `  Round ${idx + 1}: ${date.toISOString()}`)
            .join("\n")}`
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Failed to schedule payouts for circle ${circleId}: ${error.message}`,
        error.stack
      );
      // TODO: Send alert for failed payout scheduling
    }
  }

  @OnEvent(CIRCLE_EVENTS.PAYOUT_COMPLETED, { async: true })
  async handlePayoutCompleted(payload: {
    success: boolean;
    txHash: string;
    circleId: string;
    roundNumber: number;
    recipientUserId: string;
    amount: string;
    currency: string;
  }): Promise<void> {
    this.logger.log(
      `[PAYOUT_COMPLETED] Circle ${payload.circleId}, Round ${payload.roundNumber} - ${payload.amount} ${payload.currency} sent to user ${payload.recipientUserId}, txHash: ${payload.txHash}`
    );

    // TODO: Trigger notification to recipient
    // TODO: Update any analytics/metrics
  }

  @OnEvent(CIRCLE_EVENTS.PAYOUT_FAILED, { async: true })
  async handlePayoutFailed(payload: {
    type: string;
    severity: string;
    circleId: string;
    roundNumber: number;
    recipientUserId: string;
    recipientNearAccountId: string;
    payoutAmount: string;
    currency: string;
    error: string;
    timestamp: string;
  }): Promise<void> {
    this.logger.error(
      `[PAYOUT_FAILED] CRITICAL - Circle ${payload.circleId}, Round ${payload.roundNumber} - ${payload.error}`
    );

    await this.sendDevTeamAlert(payload);
  }

  @OnEvent(CIRCLE_EVENTS.ROUND_ADVANCED, { async: true })
  async handleRoundAdvanced(payload: {
    circleId: string;
    completedRound: number;
    recipientUserId: string;
    txHash: string;
  }): Promise<void> {
    this.logger.log(
      `[ROUND_ADVANCED] Circle ${payload.circleId} advanced to round ${
        payload.completedRound + 1
      }`
    );

    // TODO: Send notification to all circle members about round completion
    // TODO: Send reminder to next recipient
  }

  /**
   * Send alert to dev team via Slack/Discord
   */
  private async sendDevTeamAlert(payload: any): Promise<void> {
    const alertMessage = {
      text: `🚨 *PAYOUT FAILURE ALERT* 🚨`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "🚨 Payout Failure Alert",
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Circle ID:*\n${payload.circleId}` },
            { type: "mrkdwn", text: `*Round:*\n${payload.roundNumber}` },
            {
              type: "mrkdwn",
              text: `*Amount:*\n${payload.payoutAmount} ${payload.currency}`,
            },
            {
              type: "mrkdwn",
              text: `*Recipient:*\n${payload.recipientNearAccountId}`,
            },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Error:*\n\`\`\`${payload.error}\`\`\``,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Timestamp: ${payload.timestamp}`,
            },
          ],
        },
      ],
    };

    // TODO: Implement actual webhook call
    // const slackWebhookUrl = this.configService.get('alerts.slackWebhook');
    // const discordWebhookUrl = this.configService.get('alerts.discordWebhook');

    this.logger.warn(
      `[DEV_ALERT] Would send to Slack/Discord: ${JSON.stringify(
        alertMessage,
        null,
        2
      )}`
    );
  }
}
