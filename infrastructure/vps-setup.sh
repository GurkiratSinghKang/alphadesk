#!/usr/bin/env bash
set -euo pipefail

echo "=== AlphaDesk VPS Setup ==="

# Create deploy user
if ! id deploy &>/dev/null; then
    adduser --disabled-password --gecos "" deploy
    usermod -aG docker deploy
    echo "Created deploy user"
fi

# SSH hardening
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd
echo "SSH hardened"

# Firewall
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "Firewall configured"

# Prevent Docker from bypassing UFW
mkdir -p /etc/docker
cat > /etc/docker/daemon.json << 'EOF'
{
  "iptables": false,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
systemctl restart docker
echo "Docker configured"

# Swap
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "2GB swap created"
fi

# Fail2ban
apt-get update -qq
apt-get install -y -qq fail2ban rclone curl
systemctl enable fail2ban
echo "Fail2ban installed"

# Data directories
mkdir -p /var/lib/alphadesk/{timescaledb,redis,uptime-kuma}
chown -R deploy:deploy /var/lib/alphadesk

# App directory
mkdir -p /opt/alphadesk
chown deploy:deploy /opt/alphadesk

echo ""
echo "=== Setup complete ==="
echo "Next steps:"
echo "  1. Copy your SSH public key to /home/deploy/.ssh/authorized_keys"
echo "  2. Copy the project files to /opt/alphadesk/"
echo "  3. Create /opt/alphadesk/.env.prod from .env.prod.example"
echo "  4. Set up GitHub Actions secrets (VPS_HOST, VPS_SSH_KEY)"
echo "  5. Configure rclone for backups: rclone config"
echo "  6. Add backup cron: crontab -e -u deploy"
