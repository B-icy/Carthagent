import express from 'express';
import { copyGatewayResponseHeaders } from './gateway.mjs';

const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
const bearer = req => String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');

function oauthError(error) {
  const code = error?.message || 'server_error';
  const status = ['invalid_grant', 'invalid_token', 'revoked_token', 'access_denied'].includes(code) ? 401
    : code === 'authorization_pending' ? 428
      : code === 'expired_token' ? 410
        : code === 'insufficient_scope' ? 403 : 400;
  return { status, body: { error: code } };
}

export function cloudRouter(control, { authenticateBrowser, gateway = null } = {}) {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  const browserAccount = async req => {
    if (!authenticateBrowser) throw new Error('browser_auth_not_configured');
    const account = await authenticateBrowser(req);
    if (!account?.accountId) throw new Error('unauthorized');
    return account;
  };

  router.post('/v1/device/authorizations', (req, res) => {
    res.status(201).json(control.createDeviceAuthorization({ clientName: req.body?.clientName }));
  });
  router.post('/v1/device/authorizations/:userCode/approve', asyncRoute(async (req, res) => {
    const account = await browserAccount(req);
    res.json(control.approveDeviceAuthorization({ userCode: req.params.userCode, accountId: account.accountId, approve: req.body?.approve !== false }));
  }));
  router.post('/v1/device/token', (req, res) => {
    try { res.json(control.pollDeviceToken({ deviceCode: req.body?.deviceCode })); }
    catch (error) { const out = oauthError(error); res.status(out.status).json(out.body); }
  });
  router.post('/v1/token/refresh', (req, res) => {
    try { res.json(control.refreshSession({ refreshToken: req.body?.refreshToken })); }
    catch (error) { const out = oauthError(error); res.status(out.status).json(out.body); }
  });
  router.post('/v1/token/revoke', (req, res) => {
    try { const claims = control.verifyAccessToken(bearer(req)); res.json(control.revokeSession({ sessionId: claims.sid })); }
    catch (error) { const out = oauthError(error); res.status(out.status).json(out.body); }
  });
  router.get('/v1/models', (req, res) => {
    if (!gateway) return res.status(503).json({ error: { message: 'Cloud gateway is not configured.', type: 'api_error', code: 'gateway_not_configured' } });
    try { control.verifyAccessToken(bearer(req), 'models:read'); res.json(gateway.modelEnvelope()); }
    catch (error) { const out = oauthError(error); res.status(out.status).json(out.body); }
  });
  const invokeGateway = endpoint => asyncRoute(async (req, res) => {
    if (!gateway) return res.status(503).json({ error: { message: 'Cloud gateway is not configured.', type: 'api_error', code: 'gateway_not_configured' } });
    const claims = control.verifyAccessToken(bearer(req), 'gateway:invoke');
    let handle;
    try {
      handle = await gateway.invoke({
        accountId: claims.sub, endpoint, body: req.body,
        operationKey: req.get('idempotency-key') || undefined,
        clientRequestId: req.get('x-client-request-id') || undefined,
        signal: req.signal,
      });
    } catch (error) {
      if (error.message === 'insufficient_credit') return res.status(429).json({ error: { message: 'Carthagent Cloud credit is exhausted. Manage billing or connect your own provider with /login.', type: 'insufficient_quota', code: 'insufficient_quota' } });
      if (['model_not_found', 'request_too_large', 'max_output_tokens_exceeded', 'idempotency_key_reused', 'request_reconciliation_required'].includes(error.message)) return res.status(400).json({ error: { message: error.message, type: 'invalid_request_error', code: error.message } });
      throw error;
    }
    copyGatewayResponseHeaders(handle.response, res);
    res.status(handle.response.status);
    if (handle.response.body) {
      const chunks = [];
      try {
        for await (const chunk of handle.response.body) { const buffer = Buffer.from(chunk); chunks.push(buffer); res.write(buffer); }
        res.end();
      } finally { await gateway.finalize(handle, { responseBody: Buffer.concat(chunks) }); }
    } else {
      res.status(handle.response.status).end();
      await gateway.finalize(handle);
    }
  });
  router.post('/v1/chat/completions', invokeGateway('chat.completions'));
  router.post('/v1/responses', invokeGateway('responses'));
  router.get('/v1/account', (req, res) => {
    try {
      const claims = control.verifyAccessToken(bearer(req), 'account:read');
      res.json(control.account(claims.sub));
    } catch (error) { const out = oauthError(error); res.status(out.status).json(out.body); }
  });
  router.get('/v1/account/balance', (req, res) => {
    try {
      const claims = control.verifyAccessToken(bearer(req), 'account:read');
      const account = control.account(claims.sub);
      res.json({ accountId: claims.sub, balance: account.balance, grants: account.grants });
    } catch (error) { const out = oauthError(error); res.status(out.status).json(out.body); }
  });
  router.get('/v1/account/usage', (req, res) => {
    try {
      const claims = control.verifyAccessToken(bearer(req), 'account:read');
      const requested = Number(req.query?.limit);
      res.json({ accountId: claims.sub, data: control.usage(claims.sub, { limit: Number.isSafeInteger(requested) ? requested : 50 }) });
    } catch (error) { const out = oauthError(error); res.status(out.status).json(out.body); }
  });
  router.get('/v1/account/sessions', (req, res) => {
    try {
      const claims = control.verifyAccessToken(bearer(req), 'account:read');
      res.json({ accountId: claims.sub, currentSessionId: claims.sid, data: control.listSessions(claims.sub) });
    } catch (error) { const out = oauthError(error); res.status(out.status).json(out.body); }
  });
  router.delete('/v1/account/sessions/:sessionId', (req, res) => {
    try {
      const claims = control.verifyAccessToken(bearer(req), 'account:read');
      res.json(control.revokeAccountSession({ accountId: claims.sub, sessionId: req.params.sessionId }));
    } catch (error) {
      if (error.message === 'session_not_found') return res.status(404).json({ error: error.message });
      const out = oauthError(error); res.status(out.status).json(out.body);
    }
  });
  router.post('/v1/billing/checkout', asyncRoute(async (req, res) => {
    const claims = control.verifyAccessToken(bearer(req), 'account:read');
    res.json(await control.createCheckout({ accountId: claims.sub, successUrl: req.body?.successUrl, cancelUrl: req.body?.cancelUrl }));
  }));
  router.post('/v1/billing/portal', asyncRoute(async (req, res) => {
    const claims = control.verifyAccessToken(bearer(req), 'account:read');
    res.json(await control.createPortal({ accountId: claims.sub, returnUrl: req.body?.returnUrl }));
  }));
  router.post('/v1/webhooks/stripe', express.raw({ type: 'application/json', limit: '256kb' }), (req, res) => {
    try { res.json(control.handleStripeWebhook({ payload: req.body.toString('utf8'), signature: req.get('stripe-signature') })); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = ['unauthorized', 'browser_auth_not_configured'].includes(error.message) ? 401 : 400;
    res.status(status).json({ error: error.message });
  });
  return router;
}
