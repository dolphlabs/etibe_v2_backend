export const resetPasswordHbsTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password - Etibé</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F9FAFB; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 560px; margin: 0 auto; background-color: #FFFFFF; border-radius: 16px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">
          <!-- Header with Centered Etibé Logo -->
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
          
          <!-- Main Message -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <h1 style="margin: 0 0 12px; font-size: 24px; font-weight: 600; color: #111827; line-height: 1.3;">
                Reset Your Password 🔒
              </h1>
              <p style="margin: 0; font-size: 16px; color: #111827; line-height: 1.6;">
                Hi{{#if firstName}} {{firstName}}{{/if}},<br><br>
                We received a request to reset your Etibé password. Click the button below to create a new password:
              </p>
            </td>
          </tr>
          
          <!-- Reset Button -->
          <tr>
            <td style="padding: 0 40px 32px;">
              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="{{resetUrl}}" style="display: inline-block; background-color: #4CAF50; color: #FFFFFF; text-decoration: none; font-weight: 600; font-size: 16px; padding: 16px 48px; border-radius: 8px; box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Link Fallback -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <p style="margin: 0; font-size: 14px; color: #666666; line-height: 1.6;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin: 8px 0 0; font-size: 12px; color: #4CAF50; word-break: break-all;">
                {{resetUrl}}
              </p>
            </td>
          </tr>
          
          <!-- Expiry Notice -->
          <tr>
            <td style="padding: 0 40px 32px;">
              <div style="background-color: #FFF8E1; border-radius: 8px; padding: 16px; border-left: 4px solid #FFC107;">
                <p style="margin: 0; font-size: 14px; color: #111827;">
                  ⏱️ This link expires in <strong>1 hour</strong>. For your security, do not share this link with anyone.
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Security Notice -->
          <tr>
            <td style="padding: 0 40px 32px;">
              <p style="margin: 0; font-size: 14px; color: #666666; line-height: 1.6;">
                <strong>If you didn't request this,</strong> please ignore this email or contact our support team if you have concerns. Your password will remain unchanged.
              </p>
            </td>
          </tr>
          
          <!-- Footer with Physical Address -->
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #EEEEEE; background-color: #FAFAFA; border-radius: 0 0 16px 16px;">
              <p style="margin: 0 0 8px; font-size: 12px; color: #9E9E9E; text-align: center; line-height: 1.6;">
                Sent with ❤️ from Etibé
              </p>
              <p style="margin: 0 0 8px; font-size: 12px; color: #9E9E9E; text-align: center; line-height: 1.6;">
                © {{year}} Etibé. Built on NEAR Protocol.
              </p>
              <p style="margin: 0; font-size: 11px; color: #BDBDBD; text-align: center; line-height: 1.6;">
                Lagos, Nigeria
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

// ==========================================
// TEMPLATE PROPS INTERFACE
// ==========================================

export interface ResetPasswordEmailProps {
  firstName: string;
  resetUrl: string;
  year?: number;
}

// ==========================================
// RENDER FUNCTION (for use with Handlebars or direct rendering)
// ==========================================

export function renderResetPasswordEmail(
  props: ResetPasswordEmailProps
): string {
  const { firstName, resetUrl, year = new Date().getFullYear() } = props;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password - Etibé</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F9FAFB; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 560px; margin: 0 auto; background-color: #FFFFFF; border-radius: 16px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">
          <!-- Header with Centered Etibé Logo -->
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
          
          <!-- Main Message -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <h1 style="margin: 0 0 12px; font-size: 24px; font-weight: 600; color: #111827; line-height: 1.3;">
                Reset Your Password 🔒
              </h1>
              <p style="margin: 0; font-size: 16px; color: #111827; line-height: 1.6;">
                Hi${firstName ? ` ${firstName}` : ""},<br><br>
                We received a request to reset your Etibé password. Click the button below to create a new password:
              </p>
            </td>
          </tr>
          
          <!-- Reset Button -->
          <tr>
            <td style="padding: 0 40px 32px;">
              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${resetUrl}" style="display: inline-block; background-color: #4CAF50; color: #FFFFFF; text-decoration: none; font-weight: 600; font-size: 16px; padding: 16px 48px; border-radius: 8px; box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Link Fallback -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <p style="margin: 0; font-size: 14px; color: #666666; line-height: 1.6;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin: 8px 0 0; font-size: 12px; color: #4CAF50; word-break: break-all;">
                ${resetUrl}
              </p>
            </td>
          </tr>
          
          <!-- Expiry Notice -->
          <tr>
            <td style="padding: 0 40px 32px;">
              <div style="background-color: #FFF8E1; border-radius: 8px; padding: 16px; border-left: 4px solid #FFC107;">
                <p style="margin: 0; font-size: 14px; color: #111827;">
                  ⏱️ This link expires in <strong>1 hour</strong>. For your security, do not share this link with anyone.
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Security Notice -->
          <tr>
            <td style="padding: 0 40px 32px;">
              <p style="margin: 0; font-size: 14px; color: #666666; line-height: 1.6;">
                <strong>If you didn't request this,</strong> please ignore this email or contact our support team if you have concerns. Your password will remain unchanged.
              </p>
            </td>
          </tr>
          
          <!-- Footer with Physical Address -->
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #EEEEEE; background-color: #FAFAFA; border-radius: 0 0 16px 16px;">
              <p style="margin: 0 0 8px; font-size: 12px; color: #9E9E9E; text-align: center; line-height: 1.6;">
                Sent with ❤️ from Etibé
              </p>
              <p style="margin: 0 0 8px; font-size: 12px; color: #9E9E9E; text-align: center; line-height: 1.6;">
                © ${year} Etibé. Built on NEAR Protocol.
              </p>
              <p style="margin: 0; font-size: 11px; color: #BDBDBD; text-align: center; line-height: 1.6;">
                Lagos, Nigeria
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
