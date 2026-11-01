import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: sendMock } };
  }),
}));

// Import AFTER mocking
import { createEmailService } from '../../src/services/email.js';
import { ERROR_MSG } from '../../src/utils/constants.js';

describe('EmailService', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: 'msg_1' }, error: null });
  });

  it('isConfigured returns true when both resendApiKey and emailFrom are set', () => {
    const svc = createEmailService({ resendApiKey: 'k', emailFrom: 'x@y.z' });
    expect(svc.isConfigured()).toBe(true);
  });

  it('isConfigured returns false when resendApiKey is missing', () => {
    const svc = createEmailService({ resendApiKey: undefined, emailFrom: 'x@y.z' });
    expect(svc.isConfigured()).toBe(false);
  });

  it('isConfigured returns false when emailFrom is missing', () => {
    const svc = createEmailService({ resendApiKey: 'k', emailFrom: undefined });
    expect(svc.isConfigured()).toBe(false);
  });

  it('send forwards the message to Resend with the configured from address', async () => {
    const svc = createEmailService({ resendApiKey: 'k', emailFrom: 'Trading Bot <noreply@example.com>' });
    await svc.send({
      to: 'user@example.com',
      subject: "You've been invited",
      html: '<p>hi</p>',
      text: 'hi',
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.from).toBe('Trading Bot <noreply@example.com>');
    expect(call.to).toBe('user@example.com');
    expect(call.subject).toBe("You've been invited");
    expect(call.html).toBe('<p>hi</p>');
    expect(call.text).toBe('hi');
  });

  it('send throws EMAIL_SEND_FAILED when the service is not configured', async () => {
    const svc = createEmailService({ resendApiKey: undefined, emailFrom: 'x@y.z' });
    await expect(svc.send({ to: 'u@e.com', subject: 's', html: '<p/>', text: 't' }))
      .rejects.toThrow(ERROR_MSG.EMAIL_SEND_FAILED);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('send propagates Resend errors as EMAIL_SEND_FAILED', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const svc = createEmailService({ resendApiKey: 'k', emailFrom: 'x@y.z' });
    await expect(svc.send({ to: 'u@e.com', subject: 's', html: '<p/>', text: 't' }))
      .rejects.toThrow(ERROR_MSG.EMAIL_SEND_FAILED);
  });
});
