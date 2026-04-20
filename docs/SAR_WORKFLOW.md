# Subject Access Request (SAR) workflow

This runbook describes how the on-call operator handles incoming privacy
rights requests from users. It covers GDPR (EU/EEA/UK) and CCPA
(California) — the two regimes that impose formal response timelines.
CCPA "know" and "delete" map onto GDPR "access" and "erasure"; the
procedure is the same, only the deadline differs.

> **Single-admin context.** AlphaDesk is a single-tenant trading
> terminal. In practice the admin IS the data subject, so most SARs
> will be operator-initiated self-service. The workflow below is
> nonetheless codified so (a) it is ready for multi-tenant rollout,
> and (b) incoming regulator / third-party requests are handled with
> the same rigour.

## Timelines

| Regime | Deadline | Notes |
| ------ | -------- | ----- |
| GDPR (Art. 12) | 30 calendar days from receipt | Extendable by a further 60 days on complex requests, with a written justification sent to the subject within the original 30-day window. |
| CCPA (Cal. Civ. Code §1798.130) | 45 calendar days from receipt | Extendable by 45 days on complex requests, with written notice. |
| Notification of identity-verification failure | 30 days (GDPR) / 45 days (CCPA) | Must explain WHY we could not confirm identity and what the subject can do to retry. |

Every ticket is entered in the ``compliance_tickets`` table on receipt;
the ``received_at`` timestamp anchors all deadlines.

## Step 1 — Receipt + acknowledgement

1. Requester emails `legal@tradingalpha.net` or opens a ticket from the
   platform.
2. Operator opens a new row in `compliance_tickets`:
   - `request_type` = one of `access`, `erasure`, `rectification`,
     `portability`, `objection`, `restriction`.
   - `status` = `received`.
   - `requester_email` = the sender address.
   - `received_at` = now (server default).
3. Send the **acknowledgement email** below within 72 hours. It must
   NOT promise fulfilment, only acknowledge receipt and state the
   verification step.

### Template — acknowledgement

> **Subject:** AlphaDesk privacy request received (ticket #`{id}`)
>
> Hello,
>
> We received your `{request_type}` request on `{received_at}` UTC. We
> will respond within 30 days (GDPR) / 45 days (CCPA), whichever
> applies to you.
>
> Before we process the request we need to confirm your identity.
> Please reply to this email from the address associated with your
> AlphaDesk account, and log in to the platform once during the next
> 72 hours. A successful password-verified login will satisfy the
> identity-verification requirement.
>
> If you cannot verify via either channel, reply describing the
> obstacle and we will propose alternatives.
>
> — AlphaDesk Privacy Team

## Step 2 — Identity verification

Acceptable proofs of identity (any ONE of the following):

1. **Email + password attempt.** The requester sends the request from
   the account's email address AND performs a successful password-
   verified login during the verification window. The operator reads
   the `audit_log` table for a `login` event with `result=success` and
   `username` = the subject's admin username in the window.
2. **Out-of-band verification.** For a corporate / named subject, a
   call to the registered number on file, or a signed letter on
   letterhead.
3. **Regulator request.** A demand letter from a supervisory authority
   (DPC, CNIL, ICO, CA AG) is treated as pre-verified.

If verification succeeds:
- `compliance_tickets.identity_verified` = `TRUE`.
- `compliance_tickets.status` = `in_progress`.

If verification fails, retry once. If that also fails, escalate to the
denial path (Step 5).

## Step 3 — Fulfilment

### Access / portability

- Log in as the subject (or ask the subject to self-serve).
- Call `POST /api/v1/user/export`. The response is a JSON attachment
  named `alphadesk_export_{date}.json`.
- Attach the file to the reply email. File is encrypted at rest on
  our mail provider; if the subject prefers we can host it on a
  pre-signed URL with a 7-day expiry.
- `audit_log` automatically records a `data_export` event.

### Erasure

- Warn the subject that erasure is IRREVERSIBLE.
- Call `GET /api/v1/user/erase/preview` and paste the counts in the
  confirmation email.
- After final approval, call `POST /api/v1/user/erase` with
  `{ "confirm": true, "password": "<password>" }`.
- `audit_log` rows for trading-surveillance events
  (`halt_trading` / `resume_trading` / `wash_trade_reject` /
  `restricted_symbol_reject` / `live_gate_reject`) are kept and
  flagged `retained_for_compliance=true` under the SEC 17a-4 /
  FINRA 4530 minimum-retention exception. Explain this in the reply.

### Rectification

- Make the corrections directly in the DB. For field-level edits on
  `trades` / `positions`, use the normal API routes — do NOT UPDATE
  the DB out-of-band unless the schema is read-only for users.
- Log the edit to `audit_log` with `event=rectification` and the
  before/after values in `details`.

### Objection / restriction

- Rarely applicable on a single-admin deployment. Document the
  rationale in `compliance_tickets.notes` and return a partial /
  full denial per Step 5 if the request cannot be honoured (e.g.
  trading-surveillance data is processed on a legal-obligation basis
  which objection does not override).

## Step 4 — Completion

1. Send the **completion email** below.
2. `compliance_tickets.status` = `completed`.
3. `compliance_tickets.completed_at` = now.

### Template — completion (access / portability)

> **Subject:** AlphaDesk privacy request completed (ticket #`{id}`)
>
> Hello,
>
> Your `{request_type}` request has been fulfilled. The attached file
> `alphadesk_export_{date}.json` contains every record we hold on
> your account as of `{completed_at}` UTC.
>
> If any field looks incorrect, reply to this thread and we will open
> a rectification ticket.
>
> — AlphaDesk Privacy Team

### Template — completion (erasure)

> **Subject:** AlphaDesk erasure completed (ticket #`{id}`)
>
> Hello,
>
> We have erased every record associated with your account.
> `{audit_log_retained_for_compliance}` audit entries were retained
> under SEC 17a-4 minimum retention (halt / surveillance / live-gate
> events only) and are flagged as retained for compliance; they remain
> available to you via the export endpoint.
>
> This completes our obligation under GDPR Art. 17 / CCPA §1798.105.
>
> — AlphaDesk Privacy Team

## Step 5 — Denial

Acceptable grounds for denial (non-exhaustive):

1. **Identity verification failed** after a second attempt.
2. **Manifestly unfounded or excessive** (GDPR Art. 12(5)), e.g. the
   10th duplicate erasure request in a week from the same subject.
3. **Legal-obligation override** (GDPR Art. 17(3)(b)), e.g. requesting
   erasure of ``halt_trading`` events which are retained under SEC
   17a-4.

Denial steps:

1. `compliance_tickets.status` = `denied`.
2. `compliance_tickets.denial_reason` = a one-line summary.
3. `compliance_tickets.completed_at` = now.
4. Send the **denial email** below. The email must state the ground
   and the subject's right to complain to their supervisory
   authority.

### Template — denial

> **Subject:** AlphaDesk privacy request outcome (ticket #`{id}`)
>
> Hello,
>
> We were unable to fulfil your `{request_type}` request for the
> following reason:
>
> > `{denial_reason}`
>
> If you disagree with this outcome you may complain to your
> supervisory authority (for EU/EEA/UK subjects: your national data
> protection authority; for California subjects: the California
> Attorney General or the California Privacy Protection Agency).
>
> — AlphaDesk Privacy Team

## Audit checklist

For every ticket:

- [ ] `compliance_tickets` row created with accurate `received_at`.
- [ ] Identity verified via approved proof OR denial issued.
- [ ] Ack email sent within 72 hours.
- [ ] Fulfilment or denial completed within 30 days (GDPR) / 45 days (CCPA).
- [ ] All emails threaded on the ticket id.
- [ ] `audit_log` carries a corresponding event row (`data_export`,
      `user_erase`, `rectification`, etc.).
- [ ] If any step fell outside policy (late response, partial denial
      without explanation), escalate to `legal@tradingalpha.net`.
