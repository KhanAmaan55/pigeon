/**
 * The browser step of OAuth 2.0 authorization-code flows (PIGN-047): open the provider's page and
 * wait for the redirect back to Pigeon. Desktop: the system browser and a loopback listener
 * (`http://127.0.0.1:<port>/callback`, RFC 8252). Web: a popup and `oauth-callback.html` on the
 * Pigeon origin. Platforms without it can't run that grant.
 */

export interface OAuthRedirect {
  /** The redirect URI to register with the provider and put in the authorization URL. */
  redirectUri: string;
  /** Identifies this attempt for `complete`. */
  session: string;
}

export interface OAuthBrowser {
  /** Prepares a redirect target; a `preferred` loopback URI (with its port) is honoured. */
  begin(preferredRedirectUri?: string): Promise<OAuthRedirect>;
  /**
   * Opens `url` for the user and resolves with the query parameters of the redirect (`code`,
   * `state`, or `error`). Rejects when the window is closed, blocked or times out.
   */
  complete(session: string, url: string): Promise<Record<string, string>>;
}
