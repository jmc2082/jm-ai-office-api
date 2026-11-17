# Inbox triage (Sift)

Sift (`inbox-triage`) reads new mail from your connected mailboxes every 15 minutes and sorts it:

| Verdict | What you get |
|---|---|
| `needs_attention` | Its own card in Needs You, with a link to open the email |
| `phishing` | Its own card, marked "Possible phishing" |
| `likely_spam`, `newsletter`, `fyi` | One **Inbox digest** card per day (after `MAIL_DIGEST_HOUR_UTC`), spam listed first |

It is **read-only**: it can't send, delete, move or mark anything. Approving a card only means "seen".

## How it decides

1. **Code first** ([`src/mail/triage-rules.ts`](../../src/mail/triage-rules.ts)):
   - Sender on your VIP list and passes authentication → `needs_attention`
   - Sender on your VIP list but fails DMARC (a spoof) → `phishing`
   - Fails sender authentication (DMARC fail, or SPF fail with no DKIM) → `likely_spam`
   - Bulk mail that Gmail files under Promotions/Social, or Outlook files outside Focused → `newsletter`
2. **Everything else goes to the model**: `inbox.classify` (Claude Haiku 5.5). The email is wrapped as untrusted data, and
   the model can only answer with one of the five verdicts. Any other answer is recorded as `fyi` with
   "Could not classify", so it shows up in the digest instead of being lost.

Only metadata, a 200-character snippet and the verdict are stored (`mail_messages`). Bodies are never saved.

**Cost:** roughly 1.5k tokens per email that reaches the model. 100 such emails a day is about $0.015/day on Haiku.

## One-time setup

### 1. Encryption key

Refresh tokens are stored encrypted in SQLite. Without this key, Sift does nothing.

```bash
openssl rand -base64 32
aws ssm put-parameter --profile jmplutouser2 --region us-east-2 \
  --name /jm-office/prod/app/MAIL_TOKEN_KEY --type SecureString --value '<key>'
```

Losing or changing the key means reconnecting every mailbox.

### 2. Google (personal Gmail)

1. In Google Cloud Console, create a project and enable the **Gmail API**.
2. Under **OAuth consent screen**, choose External and add the scope `.../auth/gmail.readonly`.
   Then **publish the app to "In production"**. Leave it unverified; you'll click through a warning once.
   In "Testing" mode, Google expires refresh tokens after **7 days**.
3. Create an OAuth client ID of type **Web application**, with these redirect URIs:
   - `https://api.office.wikiboost.com/api/mail/oauth/callback/gmail`
   - `http://localhost:4100/api/mail/oauth/callback/gmail` (local dev)
4. Store `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (the secret as a SecureString) under `/jm-office/prod/app/`.

### 3. Microsoft (work Microsoft 365)

1. In Entra admin center, open **App registrations** → New registration. Choose "Accounts in this organizational directory only".
2. Add a **Web** redirect URI: `https://api.office.wikiboost.com/api/mail/oauth/callback/microsoft`, plus the localhost one.
3. Under API permissions, add Microsoft Graph **delegated** `Mail.Read`, `User.Read` and `offline_access`.
   If your tenant blocks user consent, an admin must click **Grant admin consent**.
4. Under Certificates & secrets, create a client secret. Note its expiry date: when it expires, Sift stops.
5. Store `MS_CLIENT_ID`, `MS_CLIENT_SECRET` (SecureString) and `MS_TENANT` (the Directory/tenant ID) under `/jm-office/prod/app/`.

### 4. Optional settings

| Setting | Default | |
|---|---|---|
| `MAIL_VIP_SENDERS` | empty | Comma-separated addresses or domains that always need you |
| `MAIL_DIGEST_HOUR_UTC` | `13` | Digest card appears on the first run after this hour (8 AM US Eastern in winter) |
| `MAIL_LOOKBACK_HOURS` | `24` | How far back the first sync of a new mailbox reads |
| `MAIL_MAX_PER_RUN` | `50` | Cap per mailbox per run; older extras are skipped and noted in the run log |
| `MAIL_OAUTH_REDIRECT_BASE` | `http://localhost:<PORT>/api/mail/oauth/callback` | Set to `https://api.office.wikiboost.com/api/mail/oauth/callback` in production |

Redeploy the API after changing parameters. Settings are read when the container starts.

### 5. Connect each mailbox

The dashboard has no Connect button yet, so call the API (with your Cognito access token in production):

```bash
curl -X POST https://api.office.wikiboost.com/api/mail/connect/gmail \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"label":"personal"}'
# → {"url":"https://accounts.google.com/..."}   open it within 10 minutes and sign in
```

Do the same with `/connect/microsoft` and `{"label":"work"}`. `GET /api/mail/mailboxes` shows what's connected.

## Day to day

- **Reconnect card:** if a sign-in is revoked or expires, Sift creates one "Reconnect …" card and pauses that mailbox.
  Connect it again the same way; triage resumes where it left off.
- **Wrong call?** Reject the card. Rejections are kept, so a later version can learn from them.
- **See everything triaged:** `GET /api/mail/messages?verdict=likely_spam`.
- **Disconnect:** `DELETE /api/mail/mailboxes/:id` deletes the stored token and that mailbox's triage history.
  Also remove the app's access in your Google or Microsoft account settings.
