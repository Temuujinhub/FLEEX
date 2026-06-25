// R4 — Telegram / Push / WhatsApp / Viber notification channels.
// Verifies each adapter is disabled until its credentials are configured and,
// once configured, builds the correct vendor HTTP request. fetch is mocked so
// no real network call is made.
import { TelegramService } from '../src/notifications/telegram.service';
import { PushService } from '../src/notifications/push.service';
import { WhatsAppService } from '../src/notifications/whatsapp.service';
import { ViberService } from '../src/notifications/viber.service';

type Call = { url: string; init: any };

let calls: Call[];

function mockFetch() {
  calls = [];
  global.fetch = jest.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, text: async () => '{"ok":true}' } as any;
  }) as any;
}

// Minimal stand-ins for the injected services.
const integrations = (map: Record<string, string>) => ({ resolve: async (k: string) => map[k] }) as any;
const config = (map: Record<string, string> = {}) => ({ get: (k: string) => map[k] }) as any;

const lastBody = () => JSON.parse(calls[calls.length - 1].init.body);

beforeEach(() => mockFetch());

describe('TelegramService', () => {
  it('is disabled without a bot token and sends nothing', async () => {
    const svc = new TelegramService(integrations({}));
    await svc.reload();
    expect(svc.enabled()).toBe(false);
    await svc.send(['123'], 'hi');
    expect(calls).toHaveLength(0);
  });

  it('posts sendMessage per chat id when configured', async () => {
    const svc = new TelegramService(integrations({ telegram_bot_token: '999:ABC' }));
    await svc.reload();
    expect(svc.enabled()).toBe(true);
    await svc.send(['111', '222'], 'Алдаа гарлаа');
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://api.telegram.org/bot999:ABC/sendMessage');
    const body = lastBody();
    expect(body.chat_id).toBe('222');
    expect(body.text).toBe('Алдаа гарлаа');
  });
});

describe('PushService', () => {
  it('is disabled without a server key', async () => {
    const svc = new PushService(config(), integrations({}));
    await svc.reload();
    expect(svc.enabled()).toBe(false);
    await svc.send(['tok'], 'hi');
    expect(calls).toHaveLength(0);
  });

  it('posts an FCM-style envelope with the key auth header', async () => {
    const svc = new PushService(config(), integrations({ fcm_server_key: 'SRVKEY' }));
    await svc.reload();
    await svc.send(['device-token-abc'], 'Body text', 'Title');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://fcm.googleapis.com/fcm/send');
    expect(calls[0].init.headers.authorization).toBe('key=SRVKEY');
    const body = lastBody();
    expect(body.to).toBe('device-token-abc');
    expect(body.notification).toEqual({ title: 'Title', body: 'Body text' });
  });

  it('honours a custom PUSH_ENDPOINT', async () => {
    const svc = new PushService(config({ PUSH_ENDPOINT: 'https://push.example/send' }), integrations({ fcm_server_key: 'K' }));
    await svc.reload();
    await svc.send(['t'], 'm');
    expect(calls[0].url).toBe('https://push.example/send');
  });
});

describe('WhatsAppService', () => {
  it('is disabled unless both token and phone id are set', async () => {
    const onlyToken = new WhatsAppService(config(), integrations({ whatsapp_token: 'T' }));
    await onlyToken.reload();
    expect(onlyToken.enabled()).toBe(false);

    const both = new WhatsAppService(config(), integrations({ whatsapp_token: 'T', whatsapp_phone_id: '12345' }));
    await both.reload();
    expect(both.enabled()).toBe(true);
  });

  it('posts a Cloud API text message with a Bearer token', async () => {
    const svc = new WhatsAppService(config(), integrations({ whatsapp_token: 'TOK', whatsapp_phone_id: '12345' }));
    await svc.reload();
    await svc.send(['+976 9911-2233'], 'Сэрэмжлүүлэг');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://graph.facebook.com/v18.0/12345/messages');
    expect(calls[0].init.headers.authorization).toBe('Bearer TOK');
    const body = lastBody();
    expect(body.messaging_product).toBe('whatsapp');
    expect(body.to).toBe('97699112233'); // normalised to digits
    expect(body.type).toBe('text');
    expect(body.text.body).toBe('Сэрэмжлүүлэг');
  });
});

describe('ViberService', () => {
  it('is disabled without a token', async () => {
    const svc = new ViberService(config(), integrations({}));
    await svc.reload();
    expect(svc.enabled()).toBe(false);
    await svc.send(['rcv'], 'hi');
    expect(calls).toHaveLength(0);
  });

  it('posts send_message with the auth-token header', async () => {
    const svc = new ViberService(config({ VIBER_SENDER_NAME: 'FleexOps' }), integrations({ viber_bot_token: 'VTOKEN' }));
    await svc.reload();
    await svc.send(['receiver-1'], 'Мессеж');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://chatapi.viber.com/pa/send_message');
    expect(calls[0].init.headers['x-viber-auth-token']).toBe('VTOKEN');
    const body = lastBody();
    expect(body.receiver).toBe('receiver-1');
    expect(body.type).toBe('text');
    expect(body.sender).toEqual({ name: 'FleexOps' });
    expect(body.text).toBe('Мессеж');
  });
});
