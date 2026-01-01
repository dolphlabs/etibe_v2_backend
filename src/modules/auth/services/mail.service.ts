import { Injectable, Logger, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { Resend } from "resend";
import * as Handlebars from "handlebars";
import * as fs from "fs";
import * as path from "path";

export interface SendOtpResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface OtpData {
  otp: string;
  email: string;
  deviceId: string;
  attempts: number;
  createdAt: number;
  expiresAt: number;
}

const OTP_PREFIX = "otp:";
const OTP_ATTEMPTS_PREFIX = "otp_attempts:";
const OTP_EXPIRY_SECONDS = 600; // 10 minutes
const MAX_OTP_ATTEMPTS = 3;
const LOCKOUT_DURATION_SECONDS = 1800; // 30 minutes

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend;
  private readonly fromEmail: string;
  private readonly fromName: string;
  private verifyEmailTemplate!: Handlebars.TemplateDelegate;

  constructor(
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache
  ) {
    const apiKey = this.configService.get<string>("resend.apiKey");

    if (!apiKey) {
      this.logger.warn(
        "Resend API key not configured. Emails will not be sent."
      );
    }

    this.resend = new Resend(apiKey || "");
    this.fromEmail = this.configService.get<string>(
      "resend.fromEmail",
      "noreply@etibe.app"
    );
    this.fromName = this.configService.get<string>("resend.fromName", "Etibé");

    this.loadTemplates();
  }

  private loadTemplates(): void {
    try {
      const templatePath = path.join(
        process.cwd(),
        "templates",
        "verify-email.hbs"
      );

      if (fs.existsSync(templatePath)) {
        const templateSource = fs.readFileSync(templatePath, "utf-8");
        this.verifyEmailTemplate = Handlebars.compile(templateSource);
        this.logger.log("Email templates loaded successfully");
      } else {
        this.verifyEmailTemplate = Handlebars.compile(
          this.getDefaultVerifyEmailTemplate()
        );
        this.logger.warn(
          "Using default email template (template file not found)"
        );
      }
    } catch (error) {
      this.logger.error("Failed to load email templates", error);
      this.verifyEmailTemplate = Handlebars.compile(
        this.getDefaultVerifyEmailTemplate()
      );
    }
  }

  async sendVerificationOtp(
    email: string,
    otp: string,
    deviceId: string,
    firstName: string
  ): Promise<SendOtpResult> {
    const html = this.verifyEmailTemplate({
      firstName,
      otp,
      expiryMinutes: OTP_EXPIRY_SECONDS / 60,
      year: new Date().getFullYear(),
    });

    try {
      await this.storeOtp(email, otp, deviceId);

      const { data, error } = await this.resend.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: email,
        subject: `${otp} is your Etibé verification code`,
        html,
      });

      if (error) {
        this.logger.error(`Failed to send OTP to ${email}`, error);
        return { success: false, error: error.message };
      }

      this.logger.log(`Verification OTP sent to ${email}`);
      return { success: true, messageId: data?.id };
    } catch (error) {
      this.logger.error(`Error sending OTP to ${email}`, error);
      return { success: false, error: (error as Error).message };
    }
  }

  async storeOtp(email: string, otp: string, deviceId: string): Promise<void> {
    const key = `${OTP_PREFIX}${email.toLowerCase()}`;
    const otpData: OtpData = {
      otp,
      email: email.toLowerCase(),
      deviceId,
      attempts: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + OTP_EXPIRY_SECONDS * 1000,
    };

    await this.cacheManager.set(key, otpData, OTP_EXPIRY_SECONDS * 1000);
  }

  async verifyOtp(
    email: string,
    otp: string,
    deviceId: string
  ): Promise<{ valid: boolean; error?: string }> {
    const normalizedEmail = email.toLowerCase();
    const attemptsKey = `${OTP_ATTEMPTS_PREFIX}${normalizedEmail}`;

    const attempts = await this.cacheManager.get<number>(attemptsKey);
    if (attempts && attempts >= MAX_OTP_ATTEMPTS) {
      return {
        valid: false,
        error:
          "Too many failed attempts. Please request a new code after 30 minutes.",
      };
    }

    const key = `${OTP_PREFIX}${normalizedEmail}`;
    const otpData = await this.cacheManager.get<OtpData>(key);

    if (!otpData) {
      return { valid: false, error: "Verification code expired or not found" };
    }

    if (Date.now() > otpData.expiresAt) {
      await this.cacheManager.del(key);
      return { valid: false, error: "Verification code has expired" };
    }

    if (otpData.deviceId !== deviceId) {
      this.logger.warn(
        `Device mismatch for ${email}. Expected: ${otpData.deviceId}, Got: ${deviceId}`
      );
      return {
        valid: false,
        error: "Please verify from the same device you registered with",
      };
    }

    if (otpData.otp !== otp) {
      const newAttempts = (attempts || 0) + 1;
      await this.cacheManager.set(
        attemptsKey,
        newAttempts,
        LOCKOUT_DURATION_SECONDS * 1000
      );

      const remainingAttempts = MAX_OTP_ATTEMPTS - newAttempts;
      if (remainingAttempts <= 0) {
        await this.cacheManager.del(key);
        return {
          valid: false,
          error: "Too many failed attempts. Please request a new code.",
        };
      }

      return {
        valid: false,
        error: `Invalid code. ${remainingAttempts} attempt(s) remaining.`,
      };
    }

    await this.cacheManager.del(key);
    await this.cacheManager.del(attemptsKey);

    return { valid: true };
  }

  async resendOtp(
    email: string,
    otp: string,
    deviceId: string,
    firstName: string
  ): Promise<SendOtpResult> {
    const key = `${OTP_PREFIX}${email.toLowerCase()}`;
    await this.cacheManager.del(key);

    const attemptsKey = `${OTP_ATTEMPTS_PREFIX}${email.toLowerCase()}`;
    await this.cacheManager.del(attemptsKey);

    return this.sendVerificationOtp(email, otp, deviceId, firstName);
  }

  private getDefaultVerifyEmailTemplate(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email - Etibé</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F5F5F5; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 560px; margin: 0 auto; background-color: #FFFFFF; border-radius: 16px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 24px; text-align: center;">
              <div style="font-size: 32px; font-weight: 700; color: #4CAF50; letter-spacing: -0.5px;">
                Etibé
              </div>
              <div style="font-size: 13px; color: #666666; margin-top: 4px; letter-spacing: 1px; text-transform: uppercase;">
                Decentralized Social Savings
              </div>
            </td>
          </tr>
          
          <!-- Welcome Message -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <h1 style="margin: 0 0 12px; font-size: 24px; font-weight: 600; color: #212121; line-height: 1.3;">
                Welcome{{#if firstName}}, {{firstName}}{{/if}}! 👋
              </h1>
              <p style="margin: 0; font-size: 16px; color: #424242; line-height: 1.6;">
                You're just one step away from joining the future of community savings. Enter this verification code to confirm your email:
              </p>
            </td>
          </tr>
          
          <!-- OTP Card -->
          <tr>
            <td style="padding: 0 40px 32px;">
              <div style="background: linear-gradient(135deg, #4CAF50 0%, #45A049 100%); border-radius: 12px; padding: 32px; text-align: center;">
                <div style="font-size: 13px; color: rgba(255, 255, 255, 0.9); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 2px;">
                  Verification Code
                </div>
                <div style="font-size: 42px; font-weight: 700; color: #FFFFFF; letter-spacing: 8px; font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;">
                  {{otp}}
                </div>
              </div>
            </td>
          </tr>
          
          <!-- Expiry Notice -->
          <tr>
            <td style="padding: 0 40px 32px;">
              <div style="background-color: #FFF8E1; border-radius: 8px; padding: 16px; border-left: 4px solid #FFC107;">
                <p style="margin: 0; font-size: 14px; color: #424242;">
                  ⏱️ This code expires in <strong>{{expiryMinutes}} minutes</strong>. Don't share it with anyone.
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Security Notice -->
          <tr>
            <td style="padding: 0 40px 32px;">
              <p style="margin: 0; font-size: 14px; color: #666666; line-height: 1.6;">
                If you didn't create an account with Etibé, please ignore this email or contact our support team.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #EEEEEE;">
              <p style="margin: 0; font-size: 12px; color: #9E9E9E; text-align: center; line-height: 1.6;">
                © {{year}} Etibé. Built on NEAR Protocol.<br>
                Powered by decentralized trust.
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
