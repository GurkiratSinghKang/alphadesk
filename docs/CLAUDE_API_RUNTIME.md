# Claude API Runtime

AlphaDesk can use Claude through either the Anthropic API or the local
Claude CLI. The default runtime is:

```env
CLAUDE_BACKEND=auto
```

In `auto` mode, the backend uses the Anthropic API whenever
`ANTHROPIC_API_KEY` is configured. It falls back to the local CLI only when
the API key is absent. To remove the CLI fallback entirely, set:

```env
CLAUDE_BACKEND=api
```

Keep API keys in `.env`, `/opt/alphadesk/.env.prod`, or your secret manager.
Never commit them to git.

## Raw Request And Response Audit Logs

Raw Claude request/response logging is opt-in because prompts can contain
user, account, order, and trading-context data.

Enable it with:

```env
CLAUDE_AUDIT_LOG_ENABLED=true
CLAUDE_AUDIT_LOG_DIR=/app/logs/claude
CLAUDE_AUDIT_LOG_MAX_CHARS=200000
```

Production compose bind-mounts `/app/logs/claude` to:

```text
/var/log/alphadesk/claude
```

Each call writes one JSONL record to `claude-YYYY-MM-DD.jsonl` with:

- `request_id`
- `source`
- `status`
- `context`
- raw request payload
- raw response payload or error
- duration
- token usage and estimated cost when available

The logger does not write HTTP headers or API keys. It also redacts
Anthropic-looking keys, bearer tokens, and secret-like fields as a last
line of defense.

Recommended production controls:

- Keep `/var/log/alphadesk/claude` readable only by deploy/admin users.
- Add log rotation or retention before leaving raw logging on permanently.
- Treat these logs as sensitive trading records.
