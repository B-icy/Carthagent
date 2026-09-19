import express from 'express';

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

export function cloudRouter(control, { authenticateBrowser } = {}) {
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));

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
  router.get('/v1/account', (req, res) => {
    try {
      const claims = control.verifyAccessToken(bearer(req), 'account:read');
      res.json({ accountId: claims.sub, balance: { currency: 'USD', availableNanoUsd: control.ledger.available(claims.sub) }, subscription: control.subscription(claims.sub), sessions: control.listSessions(claims.sub) });
    } catch (error) { const out = oauthError(error); res.status(out.status).json(out.body); }
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
