import { awaitCode, makePkce } from './loopback'

// Microsoft Entra, for an installed desktop app.
//
// Scope choice is the whole game here. Files.Read is what an ordinary person
// can agree to on their own; Files.Read.All and Files.ReadWrite.All were moved
// onto Microsoft's default-managed consent blocklist in 2025, and asking for
// either turns every work or school install into a ticket for an administrator
// who has never heard of us. Files.Read is enough to read a folder, so it is
// what we ask for and all we ask for.
//
// offline_access is what makes an unattended screen possible at all: without it
// there is no refresh token and the app stops working an hour after the
// operator walks away.

const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0'
export const SCOPES = 'openid profile offline_access https://graph.microsoft.com/Files.Read'

export interface Tokens {
  accessToken: string
  refreshToken: string
  /** Epoch ms. */
  expiresAt: number
  accountName?: string
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

function tokensFrom(body: TokenResponse, fallbackRefresh = ''): Tokens {
  if (!body.access_token) {
    throw new Error(body.error_description || body.error || 'Microsoft refused the sign-in.')
  }
  return {
    accessToken: body.access_token,
    // Microsoft rotates refresh tokens, but only returns a new one when it
    // chooses to; keeping the old one otherwise avoids signing the operator out
    // on a response that was otherwise perfectly good.
    refreshToken: body.refresh_token || fallbackRefresh,
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
  }
}

/** The full interactive flow. `open` is injected so this file never needs
 *  Electron, and so a test can drive it without a browser. */
export async function signIn(clientId: string, open: (url: string) => void): Promise<Tokens> {
  const pkce = makePkce()

  const { code, redirectUri } = await awaitCode({
    open,
    authorizeUrl: (redirect, state) => {
      const p = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirect,
        response_mode: 'query',
        scope: SCOPES,
        state,
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        // Force the account chooser: a signage PC is often a shared machine and
        // silently reusing whoever last signed in is a nasty surprise.
        prompt: 'select_account',
      })
      return `${AUTHORITY}/authorize?${p.toString()}`
    },
  })

  const res = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: pkce.verifier,
    }).toString(),
  })
  return tokensFrom(await res.json() as TokenResponse)
}

/** Exchanges a refresh token for a new access token.
 *
 *  invalid_grant is the one failure that is not transient — the token was
 *  revoked, the password changed, or a policy expired it — so it is turned into
 *  a message an operator can act on rather than retried forever. */
export async function refreshTokens(clientId: string, refreshToken: string): Promise<Tokens> {
  const res = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: SCOPES,
    }).toString(),
  })
  const body = await res.json() as TokenResponse
  if (body.error === 'invalid_grant') {
    throw new Error('The Microsoft sign-in has expired. Open this app\'s settings and sign in again.')
  }
  return tokensFrom(body, refreshToken)
}
