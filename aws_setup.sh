#!/bin/bash
# =============================================================================
# BANKAIFTP — AWS EC2 Setup Script (Ubuntu 22.04 / Amazon Linux 2023)
# Run as: bash aws_setup.sh
# =============================================================================
set -euo pipefail

PROJECT_DIR="$HOME/bankaiftp"
SERVICE_USER="$USER"
PYTHON_BIN=$(which python3)

echo "========================================"
echo "  BANKAIFTP AWS Setup"
echo "========================================"

# 1. System dependencies
echo "[1/7] Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
    python3-pip python3-venv git curl \
    ffmpeg \
    2>/dev/null || sudo yum install -y python3-pip python3-venv git curl 2>/dev/null || true

# 2. Create project dir (if not already there)
echo "[2/7] Setting up project directory at $PROJECT_DIR..."
mkdir -p "$PROJECT_DIR"
mkdir -p "$PROJECT_DIR"/{tokens,credentials,queue,state,logs,knowledge}

# 3. Python venv + dependencies
echo "[3/7] Creating Python virtual environment..."
cd "$PROJECT_DIR"
if [ ! -d venv ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet \
    google-auth google-auth-oauthlib google-auth-httplib2 \
    google-api-python-client \
    requests

echo "[3/7] Python deps installed ✓"

# 4. Write systemd services
echo "[4/7] Writing systemd service files..."

# ── uploader.service ──────────────────────────────────────────────────────────
sudo tee /etc/systemd/system/bankaiftp-uploader.service > /dev/null <<EOF
[Unit]
Description=BANKAIFTP Drive→YouTube Uploader
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${PROJECT_DIR}
ExecStart=${PROJECT_DIR}/venv/bin/python ${PROJECT_DIR}/drive_to_youtube_uploader.py run
Restart=always
RestartSec=30
StandardOutput=append:${PROJECT_DIR}/logs/uploader-stdout.log
StandardError=append:${PROJECT_DIR}/logs/uploader-stderr.log
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

# ── dashboard.service ─────────────────────────────────────────────────────────
sudo tee /etc/systemd/system/bankaiftp-dashboard.service > /dev/null <<EOF
[Unit]
Description=BANKAIFTP Dashboard API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${PROJECT_DIR}
ExecStart=${PROJECT_DIR}/venv/bin/python ${PROJECT_DIR}/dashboard.py
Restart=always
RestartSec=10
StandardOutput=append:${PROJECT_DIR}/logs/dashboard.log
StandardError=append:${PROJECT_DIR}/logs/dashboard-err.log
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

# ── telegram-bot.service ──────────────────────────────────────────────────────
sudo tee /etc/systemd/system/bankaiftp-telegram.service > /dev/null <<EOF
[Unit]
Description=BANKAIFTP Telegram Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${PROJECT_DIR}
ExecStart=${PROJECT_DIR}/venv/bin/python ${PROJECT_DIR}/telegram_bot.py
Restart=always
RestartSec=15
StandardOutput=append:${PROJECT_DIR}/logs/telegram.log
StandardError=append:${PROJECT_DIR}/logs/telegram-err.log
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

echo "[4/7] Systemd services written ✓"

# 5. Token auto-refresh cron (every 45 minutes — before the 1h access token expires)
echo "[5/7] Setting up token auto-refresh cron..."
CRON_JOB="*/45 * * * * ${PROJECT_DIR}/venv/bin/python ${PROJECT_DIR}/drive_to_youtube_uploader.py refresh-token 2>>${PROJECT_DIR}/logs/token-refresh.log"
(crontab -l 2>/dev/null | grep -v 'refresh-token' ; echo "$CRON_JOB") | crontab -
echo "[5/7] Cron job added (every 45 min) ✓"

# 6. Enable + start services
echo "[6/7] Enabling systemd services..."
sudo systemctl daemon-reload
sudo systemctl enable bankaiftp-uploader bankaiftp-dashboard bankaiftp-telegram
sudo systemctl restart bankaiftp-uploader bankaiftp-dashboard bankaiftp-telegram
echo "[6/7] Services enabled ✓"

# 7. Open firewall for dashboard (port 5050)
echo "[7/7] Opening firewall port 5050..."
sudo ufw allow 5050/tcp 2>/dev/null || true
# AWS security group note: also open port 5050 in EC2 → Security Groups → Inbound Rules

echo ""
echo "========================================"
echo "  Setup complete!"
echo "========================================"
echo ""
echo "Services running:"
echo "  bankaiftp-uploader   → Drive→YouTube daemon"
echo "  bankaiftp-dashboard  → API at http://<EC2-IP>:5050"
echo "  bankaiftp-telegram   → Telegram bot"
echo ""
echo "Check status:"
echo "  sudo systemctl status bankaiftp-uploader"
echo "  sudo systemctl status bankaiftp-dashboard"
echo "  sudo systemctl status bankaiftp-telegram"
echo ""
echo "Logs:"
echo "  tail -f $PROJECT_DIR/logs/uploader-stdout.log"
echo "  tail -f $PROJECT_DIR/logs/dashboard.log"
echo ""
echo "Token auto-refresh: cron runs every 45 minutes ✓"
echo ""
echo "IMPORTANT: Upload your token files before starting:"
echo "  scp tokens/*.json ubuntu@<EC2-IP>:~/bankaiftp/tokens/"
echo "  scp credentials/*.json ubuntu@<EC2-IP>:~/bankaiftp/credentials/"
echo "  scp config.json nashik-pg-uploader.env ubuntu@<EC2-IP>:~/bankaiftp/"
