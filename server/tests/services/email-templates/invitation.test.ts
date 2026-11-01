import { describe, it, expect } from 'vitest';
import { buildInvitationEmail } from '../../../src/services/email-templates/invitation.js';

describe('buildInvitationEmail', () => {
  it('returns to, subject, html, and text fields', () => {
    const msg = buildInvitationEmail('user@example.com', 'https://app.example.com/accept-invite?token=abc');
    expect(msg.to).toBe('user@example.com');
    expect(msg.subject).toMatch(/invited/i);
    expect(msg.html).toContain('https://app.example.com/accept-invite?token=abc');
    expect(msg.text).toContain('https://app.example.com/accept-invite?token=abc');
  });

  it('includes the link inside an href attribute in the HTML', () => {
    const msg = buildInvitationEmail('u@e.com', 'https://x.test/accept-invite?token=t');
    expect(msg.html).toContain('href="https://x.test/accept-invite?token=t"');
  });

  it('does not expose the raw accept URL as plain text in the HTML body', () => {
    // The HTML body only carries the link inside the button's href. The
    // plain-text body is where the URL lives as a visible string for
    // text-only email clients.
    const msg = buildInvitationEmail('u@e.com', 'https://x.test/accept-invite?token=t');
    const occurrences = (msg.html.match(/https:\/\/x\.test\/accept-invite\?token=t/g) || []).length;
    expect(occurrences).toBe(1);
  });
});
