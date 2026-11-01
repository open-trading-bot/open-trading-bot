import { Resend } from 'resend';
import { ERROR_MSG } from '../utils/constants.js';
import logger from '../utils/logger.js';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailService {
  isConfigured(): boolean;
  send(message: EmailMessage): Promise<void>;
}

export interface EmailServiceConfig {
  resendApiKey: string | undefined;
  emailFrom: string | undefined;
}

export function createEmailService(config: EmailServiceConfig): EmailService {
  const configured = Boolean(config.resendApiKey && config.emailFrom);
  return {
    isConfigured() {
      return configured;
    },
    async send(message: EmailMessage) {
      if (!configured) {
        logger.warn('[email] send() called while not configured — missing RESEND_API_KEY or EMAIL_FROM');
        throw new Error(ERROR_MSG.EMAIL_SEND_FAILED);
      }
      const client = new Resend(config.resendApiKey!);
      try {
        const { error } = await client.emails.send({
          from: config.emailFrom!,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        });
        if (error) {
          logger.error(`[email] Resend rejected the send: ${JSON.stringify(error)}`);
          throw new Error(ERROR_MSG.EMAIL_SEND_FAILED);
        }
      } catch (err: any) {
        if (err?.message === ERROR_MSG.EMAIL_SEND_FAILED) throw err;
        logger.error(`[email] Resend SDK threw: ${err?.message ?? err}`);
        throw new Error(ERROR_MSG.EMAIL_SEND_FAILED);
      }
    },
  };
}
