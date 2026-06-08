import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendEmail } from './index';

describe('sendEmail (mock-when-no-key)', () => {
  beforeEach(() => {
    delete process.env['BREVO_API_KEY'];
    delete process.env['EMAIL_FROM'];
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs to console instead of sending when BREVO_API_KEY is unset', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'body' });

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toContain('[email:console]');
    expect(log.mock.calls[0][0]).toContain('a@b.com');
    expect(fetchSpy).not.toHaveBeenCalled(); // never tried to actually send
  });

  it('does not throw when unconfigured (must not break verify/reset flow)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(
      sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'body' }),
    ).resolves.toBeUndefined();
  });

  it('calls Brevo when a key + from are configured', async () => {
    process.env['BREVO_API_KEY'] = 'fake_key';
    process.env['EMAIL_FROM'] = 'no-reply@aligned.dev';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }));

    await sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'body' });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain('brevo.com');
    expect((opts as RequestInit).method).toBe('POST');
  });
});
