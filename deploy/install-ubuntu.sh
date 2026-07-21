#!/usr/bin/env bash
set -euo pipefail

DOMAIN="wordflash.cn"
WWW_DOMAIN="www.wordflash.cn"
PROJECT_DIR="/opt/word-hunter-web"
DATA_DIR="/data/word-hunter"
ENV_DIR="/etc/word-hunter"
ENV_FILE="${ENV_DIR}/word-hunter.env"
APP_USER="www-data"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请用 root 用户执行：sudo bash deploy/install-ubuntu.sh"
  exit 1
fi

if [[ ! -f "${PROJECT_DIR}/app.py" ]]; then
  echo "没有找到 ${PROJECT_DIR}/app.py，请先把项目上传到 ${PROJECT_DIR}"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y python3 python3-venv python3-pip nginx curl

mkdir -p "${DATA_DIR}/audio-library" "${DATA_DIR}/audio-cache" "${ENV_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${DATA_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  ADMIN_KEY="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(32))
PY
)"
  {
    echo "WORD_HUNTER_ADMIN_KEY=${ADMIN_KEY}"
    echo "WORD_HUNTER_DB=${DATA_DIR}/word_hunter.db"
    echo "WORD_HUNTER_AUDIO_LIBRARY=${DATA_DIR}/audio-library"
    echo "WORD_HUNTER_AUDIO_CACHE=${DATA_DIR}/audio-cache"
  } > "${ENV_FILE}"
  chmod 640 "${ENV_FILE}"
  chown root:"${APP_USER}" "${ENV_FILE}"
fi

cd "${PROJECT_DIR}"
python3 -m venv .venv
".venv/bin/python" -m pip install --upgrade pip
".venv/bin/python" -m pip install -r requirements.txt

chown -R root:root "${PROJECT_DIR}"
find "${PROJECT_DIR}" -type d -exec chmod 755 {} \;
find "${PROJECT_DIR}" -type f -exec chmod 644 {} \;
chmod 755 "${PROJECT_DIR}/.venv/bin/python" || true

cat > /etc/systemd/system/word-hunter.service <<SERVICE
[Unit]
Description=Word Hunter Web
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${PROJECT_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${PROJECT_DIR}/.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE

cat > /etc/nginx/sites-available/wordflash.cn <<NGINX
server {
    listen 80;
    server_name ${DOMAIN} ${WWW_DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/wordflash.cn /etc/nginx/sites-enabled/wordflash.cn
rm -f /etc/nginx/sites-enabled/default

systemctl daemon-reload
systemctl enable --now word-hunter
nginx -t
systemctl reload nginx

sleep 2
curl -fsS http://127.0.0.1:8000/api/health
echo
systemctl --no-pager --full status word-hunter | sed -n '1,14p'
echo
echo "部署完成。下一步在浏览器打开：http://${DOMAIN}"
