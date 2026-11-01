import type { EmailMessage } from '../email.js';

export function buildInvitationEmail(to: string, acceptUrl: string): EmailMessage {
  const subject = "You've been invited to Trading Bot";

  const html = `
    <div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #111;">You've been invited</h2>
      <p>An administrator has invited you to join Trading Bot. Click the button below to set up your account.</p>
      <p style="margin: 32px 0;">
        <a href="${acceptUrl}" style="background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Set up your account</a>
      </p>
      <p style="color: #666; font-size: 13px;">This link expires in 72 hours. If you weren't expecting this invitation, you can safely ignore this email.</p>
    </div>
  `;

  const text = `You've been invited to Trading Bot.

An administrator has invited you to join. Set up your account here:
${acceptUrl}

This link expires in 72 hours. If you weren't expecting this invitation, you can safely ignore this email.`;

  return { to, subject, html, text };
}
