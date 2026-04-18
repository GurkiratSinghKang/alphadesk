#!/usr/bin/env bash
#
# SSH hardening — disable password auth, disable root password login.
#
# Run this ON THE VPS, as root. Before running, verify you can SSH in with
# a key:
#   1. From your laptop:  ssh -i ~/.ssh/alphadesk root@87.99.143.65 echo ok
#   2. If that prints "ok", this script is safe to run.
#   3. If it does NOT, FIX YOUR KEY FIRST — running this script without
#      a working key will lock you out.
#
# Evidence this is needed: auth.log showed 13,439 failed password logins
# and 30,138 failed btmp entries over ~8 days. fail2ban alone is not
# enough on an internet-facing box.

set -euo pipefail

SSHD_CONFIG="/etc/ssh/sshd_config"
BACKUP="$SSHD_CONFIG.bak.$(date +%Y%m%d-%H%M%S)"

if [ "$EUID" -ne 0 ]; then
    echo "Must be run as root" >&2
    exit 1
fi

echo "=== SSH hardening ==="

# Safety: confirm at least one authorized_keys file exists for a user
# that can log in. If neither root nor any existing user has a key,
# disabling password auth would brick remote access.
KEY_FOUND=0
for user_home in /root /home/*; do
    if [ -s "${user_home}/.ssh/authorized_keys" ]; then
        KEY_FOUND=1
        echo "Found authorized_keys in ${user_home}/.ssh/"
    fi
done
if [ "$KEY_FOUND" -eq 0 ]; then
    echo "ABORT: no authorized_keys file found anywhere on this host." >&2
    echo "Install a key (/root/.ssh/authorized_keys or /home/<user>/.ssh/authorized_keys) first." >&2
    exit 1
fi

cp "$SSHD_CONFIG" "$BACKUP"
echo "Backed up current sshd_config to $BACKUP"

# Helper: set or replace a directive idempotently.
set_directive() {
    local key="$1"
    local val="$2"
    if grep -qE "^\s*#?\s*${key}\b" "$SSHD_CONFIG"; then
        sed -ri "s|^\s*#?\s*${key}\b.*|${key} ${val}|" "$SSHD_CONFIG"
    else
        echo "${key} ${val}" >> "$SSHD_CONFIG"
    fi
}

set_directive PasswordAuthentication no
set_directive ChallengeResponseAuthentication no
set_directive KbdInteractiveAuthentication no
set_directive PermitRootLogin prohibit-password
set_directive UsePAM yes
set_directive PubkeyAuthentication yes

# Validate config before reload — if this fails, restore the backup.
if ! sshd -t -f "$SSHD_CONFIG"; then
    echo "sshd_config failed validation — restoring backup" >&2
    cp "$BACKUP" "$SSHD_CONFIG"
    exit 1
fi

systemctl reload sshd
echo ""
echo "=== SSH hardened ==="
echo "  PasswordAuthentication: no"
echo "  ChallengeResponseAuthentication: no"
echo "  KbdInteractiveAuthentication: no"
echo "  PermitRootLogin: prohibit-password"
echo ""
echo "Keep this session OPEN and test a new login from another terminal"
echo "BEFORE disconnecting. If the new login fails, restore with:"
echo "  cp $BACKUP $SSHD_CONFIG && systemctl reload sshd"
