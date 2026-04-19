# persona-33: Enterprise Procurement (Fintech, 20 seats)

Scope: Evaluating AlphaDesk for a 20-seat fintech deployment. Assessed SSO/SAML/OIDC,
seat provisioning, admin audit logging, SOC 2 readiness, and billing/procurement
artefacts. Findings based on direct repo inspection. Cross-refs:
`audit-reports/persona-17-compliance.md`, `audit-reports/security-audit-r3.md`.

---

## Top 10 enterprise-readiness gaps

1. **No SSO of any kind — SAML, OIDC, OAuth2, or social IdP.** A full-repo
   grep for `SAML|OIDC|okta|azure.*ad|idp|workspace` returns zero hits in
   production code. `persona-20-educator.md:164` confirms: "no SSO (no
   `/oauth`, no `/saml`, no `/ldap` in routes)." Auth is username+password only
   via `POST /api/v1/auth/login` (`backend/api/routes/auth.py:299`).
   **Hard blocker** for any fintech with an SSO mandate.

2. **Single-admin architecture — no multi-user, no seats, no teams.** The
   backend hardcodes ONE credential: `settings.ADMIN_USERNAME` (default `"admin"`,
   `backend/core/config.py:80`) checked against an env-var bcrypt hash. There is
   no `User` ORM model (`backend/data/storage/models.py` has zero user tables —
   only strategies/trades/watchlists). `persona-17-compliance.md:55` confirms:
   "Privacy Policy claims multi-user features that don't exist."
   **20 seats is not orderable.** You would share one credential across the team.

3. **Admin role is a singleton stringly-typed dependency, not RBAC.**
   `require_admin` (`backend/api/routes/auth.py:92-105`) is a literal string
   equality check: `if username != settings.ADMIN_USERNAME`. No roles table,
   no permissions table, no group membership, no role hierarchy. A comment at
   `auth.py:91` explicitly defers this: "In a multi-user future this should
   resolve against a proper role/permission record."

4. **Audit logging covers authN only — not privileged admin actions.**
   `alphadesk.audit` logger (`backend/api/routes/auth.py:14`) fires on login,
   logout, and refresh. Per `persona-17-compliance.md:14-23`, every mutating
   privileged route (order placement, order cancel, halt/resume, pipeline
   run/cancel, strategy toggle, risk-monitor kill-switch, webhook alerts)
   emits only plain `logger.info` with no `event/user/ip` structured fields.
   A regulator or internal-audit query "who disabled risk checks at 14:02?"
   cannot be answered.

5. **No dedicated admin audit log UI or export.** There is no
   `/admin/audit` or `/admin/logs` route. The audit stream is a Python logger
   shipping to stdout. No retention policy, no tamper-evident store, no
   SIEM/CEF export, no search UI. Compliance teams must scrape container logs.

6. **SOC 2 posture: no observable artefacts.** Zero matches across the repo
   for `SOC.?2|type.?ii|penetration|pen.?test|vulnerability.?disclosure`. No
   `/trust`, `/security`, or `/compliance` pages; no `SECURITY.md`; no
   vendor-security questionnaire template; no published sub-processor list.
   Privacy Policy footer (`frontend/src/app/terms/_terms/content.tsx`) names
   Alpaca + Anthropic as processors but there is no DPA template, no SIG-lite,
   no CAIQ.

7. **No billing, pricing, or subscription plumbing.** No `stripe|paddle|
   chargebee` deps; no `subscription` / `invoice` / `plan` tables; no
   `/billing` route. `frontend/src/app/terms/_terms/content.tsx:25-28` states
   the platform is **invite-only**: "Access is granted at our sole discretion."
   There is no self-serve purchase path, no enterprise order form, no
   negotiated-MSA scaffolding, no usage metering for seat-based invoicing.

8. **No password-reset backend; no account lifecycle.** `frontend/src/app/
   login/reset/page.tsx` is a stub (`persona-17-compliance.md:79-85`). No
   account deletion endpoint, no offboarding flow, no just-in-time
   provisioning, no SCIM. For a 20-seat rollout: onboarding each hire and
   removing each leaver is a manual env-var edit + bcrypt-hash regeneration.

9. **Rate limiting is per-IP only — no per-tenant, no abuse shield.** Login
   limit is 5/5min/IP (`auth.py:112-113`). For 20 teammates behind a single
   NAT/VPN this cap is **shared across the entire company**; one typo from
   user A locks out users B–T. `auth.py:110-111` TODO notes `/agents/chat` and
   `/pipeline/run` are still unratelimited. Cost-cap for expensive AI calls
   at the team level does not exist.

10. **Regulated-context posture insufficient for fintech.** `_submit_to_broker`
    hard-blocks non-paper Alpaca URLs (`trades.py:1180-1185`) — i.e. **paper
    trading only in production** — but the dashboard never surfaces this
    (`persona-17-compliance.md:72`). Order rejects, cancels, and the risk-
    monitor kill-switch are not audit-logged (`persona-17-compliance.md:25-100`).
    No WORM storage, no 7-year broker-record retention, no Rule 17a-4 posture.

---

## 250-word procurement summary

AlphaDesk is **not enterprise-ready for a 20-seat fintech**. The single
most consequential finding is architectural: the platform is a
**single-admin system**. `settings.ADMIN_USERNAME` is one hardcoded
string compared against one bcrypt hash — there is no `User` table, no
roles, no team/organization/tenant concept, and no seat abstraction of
any kind. The frontend `WorkspaceSelector` is a UI-preference toggle
over five static layout presets (default / research / trading / risk /
eod), not a multi-tenant workspace.

**SSO is absent.** A full-repo search for SAML, OIDC, OAuth2
provider code, Okta, Azure AD, or LDAP returns zero hits. Auth is
exclusively username + password with JWT cookies. For any fintech with
an SSO policy, this is a hard blocker.

**Audit logging is partial.** A structured `alphadesk.audit` logger
exists but only fires on login/logout/refresh — every mutating
privileged action (order submit/cancel, pipeline run, risk-monitor
kill-switch) emits plain logs without structured event/user/IP fields.
Admin actions cannot be reconstructed for regulator queries.

**SOC 2 posture is effectively nil.** No Type II artefacts, no
`SECURITY.md`, no DPA template, no published sub-processor list, no
pen-test attestation.

**Billing does not exist.** The ToS explicitly says AlphaDesk is
invite-only. No Stripe/Paddle integration, no plans, no invoicing, no
MSA scaffolding, no SCIM for provisioning or deprovisioning.

**Recommendation: do not procure.** This is a single-operator product
masquerading as a platform. Revisit only after multi-user auth, SSO,
RBAC, admin audit trail, and SOC 2 Type I are in place.
