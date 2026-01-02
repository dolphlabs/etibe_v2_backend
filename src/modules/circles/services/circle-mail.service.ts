import { Injectable, Logger, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";
import * as Handlebars from "handlebars";
import * as fs from "fs";
import * as path from "path";

@Injectable()
export class CircleMailService {
  private readonly logger = new Logger(CircleMailService.name);
  private readonly resend: Resend;
  private readonly fromEmail: string;
  private readonly fromName: string;

  private circleCreatedTemplate!: Handlebars.TemplateDelegate;
  private circleInvitationTemplate!: Handlebars.TemplateDelegate;
  private memberJoinedTemplate!: Handlebars.TemplateDelegate;
  private contributionReceivedTemplate!: Handlebars.TemplateDelegate;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("resend.apiKey");
    this.resend = new Resend(apiKey || "");
    this.fromEmail = this.configService.get<string>(
      "resend.fromEmail",
      "noreply@etibe.app"
    );
    this.fromName = this.configService.get<string>("resend.fromName", "Etibé");

    this.loadTemplates();
  }

  private loadTemplates(): void {
    this.circleCreatedTemplate = this.loadOrDefault(
      "circle-created.hbs",
      this.getCircleCreatedTemplate()
    );
    this.circleInvitationTemplate = this.loadOrDefault(
      "circle-invitation.hbs",
      this.getCircleInvitationTemplate()
    );
    this.memberJoinedTemplate = this.loadOrDefault(
      "member-joined.hbs",
      this.getMemberJoinedTemplate()
    );
    this.contributionReceivedTemplate = this.loadOrDefault(
      "contribution-received.hbs",
      this.getContributionReceivedTemplate()
    );

    this.logger.log("Circle email templates loaded");
  }

  private loadOrDefault(
    filename: string,
    defaultTemplate: string
  ): Handlebars.TemplateDelegate {
    try {
      const templatePath = path.join(process.cwd(), "templates", filename);
      if (fs.existsSync(templatePath)) {
        return Handlebars.compile(fs.readFileSync(templatePath, "utf-8"));
      }
    } catch (error) {
      this.logger.warn(`Failed to load ${filename}, using default`);
    }
    return Handlebars.compile(defaultTemplate);
  }

  async sendCircleCreatedEmail(
    email: string,
    firstName: string,
    circleName: string,
    inviteCode: string,
    inviteLink: string
  ): Promise<void> {
    const html = this.circleCreatedTemplate({
      firstName,
      circleName,
      inviteCode,
      inviteLink,
      year: new Date().getFullYear(),
    });

    try {
      await this.resend.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: email,
        subject: `🎉 Your circle "${circleName}" is ready!`,
        html,
      });
      this.logger.log(`Circle created email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send circle created email`, error);
    }
  }

  async sendCircleInvitationEmail(
    email: string,
    inviterFirstName: string,
    inviterLastName: string,
    circleName: string,
    inviteCode: string,
    inviteLink: string
  ): Promise<void> {
    const html = this.circleInvitationTemplate({
      inviterName: `${inviterFirstName} ${inviterLastName}`,
      circleName,
      inviteCode,
      inviteLink,
      year: new Date().getFullYear(),
    });

    try {
      await this.resend.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: email,
        subject: `${inviterFirstName} invited you to join "${circleName}" on Etibé`,
        html,
      });
      this.logger.log(`Circle invitation email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send invitation email`, error);
    }
  }

  async sendMemberJoinedEmail(
    email: string,
    recipientFirstName: string,
    circleName: string,
    newMemberFirstName: string,
    newMemberLastName: string
  ): Promise<void> {
    const html = this.memberJoinedTemplate({
      firstName: recipientFirstName,
      circleName,
      newMemberName: `${newMemberFirstName} ${newMemberLastName}`,
      year: new Date().getFullYear(),
    });

    try {
      await this.resend.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: email,
        subject: `${newMemberFirstName} joined "${circleName}"`,
        html,
      });
    } catch (error) {
      this.logger.error(`Failed to send member joined email`, error);
    }
  }

  async sendContributionReceivedEmail(
    email: string,
    firstName: string,
    circleName: string,
    amount: string,
    currency: string,
    round: number
  ): Promise<void> {
    const html = this.contributionReceivedTemplate({
      firstName,
      circleName,
      amount,
      currency,
      round,
      year: new Date().getFullYear(),
    });

    try {
      await this.resend.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: email,
        subject: `✅ Contribution confirmed for "${circleName}"`,
        html,
      });
      this.logger.log(`Contribution email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send contribution email`, error);
    }
  }

  private getCircleCreatedTemplate(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Circle Created - Etibé</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F5F5F5; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 560px; margin: 0 auto; background-color: #FFFFFF; border-radius: 16px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">
          <tr>
            <td style="padding: 40px 40px 24px; text-align: center;">
              <div style="font-size: 32px; font-weight: 700; color: #4CAF50; letter-spacing: -0.5px;">Etibé</div>
              <div style="font-size: 13px; color: #666666; margin-top: 4px; letter-spacing: 1px; text-transform: uppercase;">Decentralized Social Savings</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 24px;">
              <h1 style="margin: 0 0 12px; font-size: 24px; font-weight: 600; color: #212121; line-height: 1.3;">
                Congratulations, {{firstName}}! 🎉
              </h1>
              <p style="margin: 0; font-size: 16px; color: #424242; line-height: 1.6;">
                Your savings circle <strong>"{{circleName}}"</strong> has been created successfully. Share the invite code below to invite your friends and family.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 32px;">
              <div style="background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%); border-radius: 12px; padding: 32px; text-align: center;">
                <div style="font-size: 13px; color: rgba(255, 255, 255, 0.9); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 2px;">Invite Code</div>
                <div style="font-size: 36px; font-weight: 700; color: #FFFFFF; letter-spacing: 6px; font-family: 'SF Mono', 'Monaco', monospace;">{{inviteCode}}</div>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 32px; text-align: center;">
              <a href="{{inviteLink}}" style="display: inline-block; background-color: #4CAF50; color: #FFFFFF; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Share Invite Link</a>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 32px;">
              <div style="background-color: #E8F5E9; border-radius: 8px; padding: 16px; border-left: 4px solid #4CAF50;">
                <p style="margin: 0; font-size: 14px; color: #2E7D32;">
                  <strong>What's next?</strong> Once members join and you deploy the smart contract from the app, your circle will become active and contributions can begin!
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #EEEEEE;">
              <p style="margin: 0; font-size: 12px; color: #9E9E9E; text-align: center; line-height: 1.6;">
                © {{year}} Etibé. Built on NEAR Protocol.<br>Powered by decentralized trust.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
  }

  private getCircleInvitationTemplate(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're Invited - Etibé</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F5F5F5; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 560px; margin: 0 auto; background-color: #FFFFFF; border-radius: 16px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">
          <tr>
            <td style="padding: 40px 40px 24px; text-align: center;">
              <div style="font-size: 32px; font-weight: 700; color: #4CAF50; letter-spacing: -0.5px;">Etibé</div>
              <div style="font-size: 13px; color: #666666; margin-top: 4px; letter-spacing: 1px; text-transform: uppercase;">Decentralized Social Savings</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 24px;">
              <h1 style="margin: 0 0 12px; font-size: 24px; font-weight: 600; color: #212121; line-height: 1.3;">
                You're Invited! 💌
              </h1>
              <p style="margin: 0; font-size: 16px; color: #424242; line-height: 1.6;">
                <strong>{{inviterName}}</strong> has invited you to join the savings circle <strong>"{{circleName}}"</strong> on Etibé - the decentralized social savings platform.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 32px;">
              <div style="background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%); border-radius: 12px; padding: 32px; text-align: center;">
                <div style="font-size: 13px; color: rgba(255, 255, 255, 0.9); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 2px;">Your Invite Code</div>
                <div style="font-size: 36px; font-weight: 700; color: #FFFFFF; letter-spacing: 6px; font-family: 'SF Mono', 'Monaco', monospace;">{{inviteCode}}</div>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 32px; text-align: center;">
              <a href="{{inviteLink}}" style="display: inline-block; background-color: #4CAF50; color: #FFFFFF; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Join Circle</a>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 32px;">
              <div style="background-color: #FFF8E1; border-radius: 8px; padding: 16px; border-left: 4px solid #FFC107;">
                <p style="margin: 0; font-size: 14px; color: #424242;">
                  <strong>What is Etibé?</strong> A decentralized platform where trusted groups save together. Each member contributes regularly, and each takes turns receiving the pooled funds.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #EEEEEE;">
              <p style="margin: 0; font-size: 12px; color: #9E9E9E; text-align: center; line-height: 1.6;">
                © {{year}} Etibé. Built on NEAR Protocol.<br>Powered by decentralized trust.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
  }

  private getMemberJoinedTemplate(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Member Joined - Etibé</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F5F5F5; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 560px; margin: 0 auto; background-color: #FFFFFF; border-radius: 16px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">
          <tr>
            <td style="padding: 40px 40px 24px; text-align: center;">
              <div style="font-size: 32px; font-weight: 700; color: #4CAF50; letter-spacing: -0.5px;">Etibé</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 24px;">
              <h1 style="margin: 0 0 12px; font-size: 24px; font-weight: 600; color: #212121; line-height: 1.3;">
                New Member Alert! 🎊
              </h1>
              <p style="margin: 0; font-size: 16px; color: #424242; line-height: 1.6;">
                Hi {{firstName}}, great news! <strong>{{newMemberName}}</strong> has joined your circle <strong>"{{circleName}}"</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 32px;">
              <div style="background-color: #E8F5E9; border-radius: 12px; padding: 24px; text-align: center;">
                <div style="font-size: 48px; margin-bottom: 8px;">👋</div>
                <div style="font-size: 18px; font-weight: 600; color: #2E7D32;">Welcome to the circle, {{newMemberName}}!</div>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #EEEEEE;">
              <p style="margin: 0; font-size: 12px; color: #9E9E9E; text-align: center; line-height: 1.6;">
                © {{year}} Etibé. Built on NEAR Protocol.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
  }

  private getContributionReceivedTemplate(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contribution Confirmed - Etibé</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F5F5F5; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 560px; margin: 0 auto; background-color: #FFFFFF; border-radius: 16px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">
          <tr>
            <td style="padding: 40px 40px 24px; text-align: center;">
              <div style="font-size: 32px; font-weight: 700; color: #4CAF50; letter-spacing: -0.5px;">Etibé</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 24px;">
              <h1 style="margin: 0 0 12px; font-size: 24px; font-weight: 600; color: #212121; line-height: 1.3;">
                Contribution Confirmed! ✅
              </h1>
              <p style="margin: 0; font-size: 16px; color: #424242; line-height: 1.6;">
                Hi {{firstName}}, your contribution to <strong>"{{circleName}}"</strong> has been verified on the blockchain.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 32px;">
              <div style="background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%); border-radius: 12px; padding: 32px; text-align: center;">
                <div style="font-size: 13px; color: rgba(255, 255, 255, 0.9); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 2px;">Amount Contributed</div>
                <div style="font-size: 36px; font-weight: 700; color: #FFFFFF;">{{amount}} {{currency}}</div>
                <div style="font-size: 14px; color: rgba(255, 255, 255, 0.8); margin-top: 8px;">Round {{round}}</div>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 32px;">
              <div style="background-color: #E8F5E9; border-radius: 8px; padding: 16px; border-left: 4px solid #4CAF50;">
                <p style="margin: 0; font-size: 14px; color: #2E7D32;">
                  🔒 Your contribution is securely recorded on the NEAR blockchain and cannot be altered.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #EEEEEE;">
              <p style="margin: 0; font-size: 12px; color: #9E9E9E; text-align: center; line-height: 1.6;">
                © {{year}} Etibé. Built on NEAR Protocol.<br>Powered by decentralized trust.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
  }
}
