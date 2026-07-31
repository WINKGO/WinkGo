#!/usr/bin/env bash
# Modified from AionUI by WINK GO contributors in 2026.
# ============================================================================
# WINK GO — Ubuntu / Debian 一鍵自動化安裝腳本
# ============================================================================
# 功能：
#   1. 自動偵測系統架構 (amd64 / arm64)
#   2. 從 GitHub Release 下載指定版本的 .deb 套件（預設 latest）
#   3. 安裝 .deb + 自動修復依賴
#   4. 安裝 Xvfb 等 headless 運行所需套件
#   5. 建立服務管理腳本 (/opt/WinkGo/start-winkgo.sh)
#   6. (可選) 建立 systemd service
#   7. (可選) 建立桌面捷徑
#
# 兼容說明：公開產品名為 WINK GO；安裝後的執行檔、資料路徑、服務名與
# WINKGO_* 環境變數仍可能沿用 WinkGo/winkgo 名稱，以兼容既有安裝。
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/WINKGO/wink-go/main/scripts/install-ubuntu.sh | bash
#   # 或指定版本：
#   WINKGO_VERSION=2.2.0 bash install-ubuntu.sh
#   # 僅安裝桌面版（跳過 headless 設定）：
#   WINKGO_MODE=desktop bash install-ubuntu.sh
# ============================================================================

set -euo pipefail

# ─── 顏色定義 ───────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ─── 輔助函式 ───────────────────────────────────────────────────────────────
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*" >&2; }
die()     { error "$*"; exit 1; }

banner() {
    echo -e "${CYAN}${BOLD}"
    echo "  ╔══════════════════════════════════════════════╗"
    echo "  ║        WINK GO Installer for Ubuntu        ║"
    echo "  ╚══════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# ─── 前置檢查 ───────────────────────────────────────────────────────────────
check_prerequisites() {
    # 必須是 Linux
    [[ "$(uname -s)" == "Linux" ]] || die "此腳本僅支援 Linux 系統"

    # 必須有 apt (Debian/Ubuntu 系列)
    command -v apt-get &>/dev/null || die "此腳本需要 apt-get (Debian/Ubuntu 系列)"

    # 建議以 root 或 sudo 執行
    if [[ $EUID -ne 0 ]]; then
        if command -v sudo &>/dev/null; then
            SUDO="sudo"
            warn "非 root 使用者，將使用 sudo 執行安裝"
        else
            die "請以 root 身份執行，或安裝 sudo"
        fi
    else
        SUDO=""
    fi
}

# ─── 偵測架構 ───────────────────────────────────────────────────────────────
detect_arch() {
    local machine
    machine="$(uname -m)"
    case "$machine" in
        x86_64|amd64)
            RELEASE_ARCH="x64"
            ;;
        aarch64|arm64)
            RELEASE_ARCH="arm64"
            ;;
        *)
            die "不支援的架構: $machine（僅支援 x86_64 / aarch64）"
            ;;
    esac
    info "偵測到系統架構: ${BOLD}$machine${NC} → Release 架構: ${BOLD}$RELEASE_ARCH${NC}"
}

# ─── 取得版本號 ──────────────────────────────────────────────────────────────
resolve_version() {
    if [[ -n "${WINKGO_VERSION:-}" ]]; then
        VERSION="$WINKGO_VERSION"
        info "使用指定版本: ${BOLD}v$VERSION${NC}"
    else
        info "正在查詢最新版本..."
        # 透過 GitHub API 取得 latest release tag
        if command -v curl &>/dev/null; then
            VERSION=$(curl -fsSL "https://api.github.com/repos/WINKGO/wink-go/releases/latest" \
                | grep '"tag_name"' | head -1 | sed 's/.*"v\([^"]*\)".*/\1/')
        elif command -v wget &>/dev/null; then
            VERSION=$(wget -qO- "https://api.github.com/repos/WINKGO/wink-go/releases/latest" \
                | grep '"tag_name"' | head -1 | sed 's/.*"v\([^"]*\)".*/\1/')
        else
            die "需要 curl 或 wget 來下載，請先安裝: sudo apt-get install -y curl"
        fi

        if [[ -z "$VERSION" ]]; then
            die "無法取得最新版本號，請手動指定: WINKGO_VERSION=2.2.0 bash $0"
        fi
        info "最新版本: ${BOLD}v$VERSION${NC}"
    fi

    DEB_FILENAME="WINK-GO-Free-${VERSION}-linux-${RELEASE_ARCH}.deb"
    DOWNLOAD_URL="https://github.com/WINKGO/wink-go/releases/download/v${VERSION}/${DEB_FILENAME}"
}

# ─── 下載 .deb 套件 ──────────────────────────────────────────────────────────
download_deb() {
    local tmpdir
    tmpdir="$(mktemp -d)"
    DEB_PATH="${tmpdir}/${DEB_FILENAME}"

    info "下載 ${BOLD}$DEB_FILENAME${NC} ..."
    info "網址: $DOWNLOAD_URL"

    if command -v curl &>/dev/null; then
        curl -fSL --progress-bar -o "$DEB_PATH" "$DOWNLOAD_URL" || die "下載失敗"
    elif command -v wget &>/dev/null; then
        wget --show-progress -q -O "$DEB_PATH" "$DOWNLOAD_URL" || die "下載失敗"
    fi

    local size
    size=$(du -h "$DEB_PATH" | cut -f1)
    success "下載完成 ($size)"
}

# ─── 安裝 .deb + 修復依賴 ────────────────────────────────────────────────────
install_deb() {
    info "安裝 WINK GO .deb 套件..."

    # dpkg 安裝（可能會缺依賴）
    $SUDO dpkg -i "$DEB_PATH" 2>/dev/null || true

    # 自動修復缺失的依賴
    info "修復依賴套件..."
    $SUDO apt-get install -f -y

    success "WINK GO v${VERSION} 安裝完成"

    # 驗證安裝
    if command -v WinkGo &>/dev/null || [[ -x /usr/bin/WinkGo ]]; then
        success "WINK GO 已安裝；兼容執行檔位於 $(which WinkGo 2>/dev/null || echo '/usr/bin/WinkGo')"
    else
        warn "安裝可能不完整，找不到 WINK GO 的兼容執行檔 WinkGo"
    fi

    # 清理暫存
    rm -rf "$(dirname "$DEB_PATH")"
}

# ─── 安裝 Headless 依賴 ──────────────────────────────────────────────────────
install_headless_deps() {
    info "安裝 headless 運行所需套件 (Xvfb 等)..."

    $SUDO apt-get update -qq
    $SUDO apt-get install -y --no-install-recommends \
        xvfb \
        libxkbcommon-x11-0 \
        libgtk-3-0 \
        libnotify4 \
        libnss3 \
        libxss1 \
        libasound2 \
        libgbm1 \
        libicu-dev \
        2>/dev/null || warn "部分套件可能已安裝或不可用"

    success "Headless 依賴安裝完成"
}

# ─── 建立服務管理腳本 ─────────────────────────────────────────────────────────
create_service_script() {
    local script_dir="/opt/WinkGo"
    local script_path="${script_dir}/start-winkgo.sh"

    info "建立服務管理腳本: $script_path"
    $SUDO mkdir -p "$script_dir"

    $SUDO tee "$script_path" > /dev/null << 'SCRIPT_EOF'
#!/bin/bash
# ============================================================================
# WINK GO WebUI Headless 服務管理腳本
# 用法: ./start-winkgo.sh [start|stop|restart|status|logs]
# ============================================================================

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/winkgo"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-$STATE_DIR/run}"
PIDFILE="$RUNTIME_DIR/winkgo.pid"
LOGFILE="$STATE_DIR/winkgo.log"
WORKDIR="${WINKGO_WORKDIR:-$HOME}"

start() {
    mkdir -p "$STATE_DIR" "$RUNTIME_DIR"
    chmod 700 "$STATE_DIR" "$RUNTIME_DIR"
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        echo "⚡ WINK GO 已在執行中 (PID: $(cat "$PIDFILE"))"
        return 1
    fi

    echo "🚀 正在啟動 WINK GO WebUI..."
    cd "$WORKDIR" || exit 1

    nohup xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" \
        /usr/bin/WinkGo --webui --remote \
        > "$LOGFILE" 2>&1 &

    echo $! > "$PIDFILE"
    sleep 3

    if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        echo "✅ WINK GO 啟動成功 (PID: $(cat "$PIDFILE"))"
        local ip
        ip=$(hostname -I 2>/dev/null | awk '{print $1}')
        echo "🌐 WebUI: http://${ip:-localhost}:25808"
    else
        echo "❌ WINK GO 啟動失敗，請查看日誌: $LOGFILE"
        rm -f "$PIDFILE"
        return 1
    fi
}

stop() {
    if [ ! -f "$PIDFILE" ]; then
        echo "⚠️  WINK GO 未在執行"
        return 1
    fi
    local pid
    pid=$(cat "$PIDFILE")
    echo "🛑 正在停止 WINK GO (PID: $pid)..."
    kill "$pid" 2>/dev/null
    sleep 2
    kill -9 "$pid" 2>/dev/null
    pkill -f "WinkGo --webui" 2>/dev/null
    rm -f "$PIDFILE"
    echo "✅ WINK GO 已停止"
}

restart() {
    stop 2>/dev/null
    sleep 1
    start
}

status() {
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        echo "✅ WINK GO 執行中 (PID: $(cat "$PIDFILE"))"
        ss -tlnp 2>/dev/null | grep 25808 || netstat -tlnp 2>/dev/null | grep 25808 || true
    else
        echo "⚠️  WINK GO 未在執行"
        rm -f "$PIDFILE" 2>/dev/null
    fi
}

logs() {
    if [ -f "$LOGFILE" ]; then
        tail -f "$LOGFILE"
    else
        echo "日誌檔案不存在: $LOGFILE"
    fi
}

case "${1:-}" in
    start)   start ;;
    stop)    stop ;;
    restart) restart ;;
    status)  status ;;
    logs)    logs ;;
    "")
        echo "用法: $0 {start|stop|restart|status|logs}"
        echo ""
        echo "環境變數:"
        echo "  WINKGO_WORKDIR  - WINK GO 工作目錄 (預設: \$HOME)"
        ;;
    *)
        echo "用法: $0 {start|stop|restart|status|logs}"
        exit 1
        ;;
esac
SCRIPT_EOF

    $SUDO chmod +x "$script_path"
    success "服務管理腳本已建立: $script_path"
}

# ─── 建立非特權服務帳號 ──────────────────────────────────────────────────────
create_service_account() {
    if getent passwd winkgo >/dev/null 2>&1; then
        success "非特權服務帳號已存在: winkgo"
        return
    fi

    info "建立非特權服務帳號: winkgo"
    $SUDO useradd \
        --system \
        --user-group \
        --create-home \
        --home-dir /var/lib/winkgo \
        --shell /usr/sbin/nologin \
        winkgo
    success "非特權服務帳號已建立: winkgo"
}

# ─── 建立 systemd service (可選) ─────────────────────────────────────────────
create_systemd_service() {
    # 若系統不支援 systemd 則跳過
    if ! command -v systemctl &>/dev/null; then
        info "系統不支援 systemd，跳過 service 建立"
        return
    fi

    local service_path="/etc/systemd/system/winkgo.service"

    info "建立 systemd 服務: $service_path"

    $SUDO tee "$service_path" > /dev/null << 'SERVICE_EOF'
[Unit]
Description=WINK GO AI Agent Desktop App (WebUI Mode)
Documentation=https://github.com/WINKGO/wink-go
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=winkgo
Group=winkgo
WorkingDirectory=/var/lib/winkgo
Environment=HOME=/var/lib/winkgo
Environment=WINKGO_WORKDIR=/var/lib/winkgo
ExecStart=/usr/bin/xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" /usr/bin/WinkGo --webui --remote
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

# 安全性設定
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
StateDirectory=winkgo
RuntimeDirectory=winkgo
UMask=0077

[Install]
WantedBy=multi-user.target
SERVICE_EOF

    $SUDO systemctl daemon-reload
    success "systemd 服務已建立"
    info "使用方式:"
    echo "    sudo systemctl start winkgo     # 啟動"
    echo "    sudo systemctl stop winkgo      # 停止"
    echo "    sudo systemctl enable winkgo    # 開機自動啟動"
    echo "    sudo systemctl status winkgo    # 查看狀態"
    echo "    journalctl -u winkgo -f         # 查看日誌"
}

# ─── 建立桌面捷徑 ─────────────────────────────────────────────────────────────
create_desktop_entry() {
    local desktop_dir="${HOME}/.local/share/applications"
    local desktop_file="${desktop_dir}/winkgo.desktop"

    mkdir -p "$desktop_dir"

    cat > "$desktop_file" << 'DESKTOP_EOF'
[Desktop Entry]
Name=WINK GO
Comment=AI Agent Cowork Platform
Exec=/usr/bin/WinkGo %U
Icon=WinkGo
Terminal=false
Type=Application
Categories=Office;Utility;Development;
MimeType=x-scheme-handler/winkgo;
StartupWMClass=WinkGo
DESKTOP_EOF

    success "桌面捷徑已建立: $desktop_file"
}

# ─── 顯示安裝摘要 ─────────────────────────────────────────────────────────────
print_summary() {
    echo ""
    echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}${BOLD}  🎉 WINK GO v${VERSION} 安裝完成！${NC}"
    echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${BOLD}📍 執行檔位置:${NC}  /usr/bin/WinkGo"
    echo -e "  ${BOLD}📍 管理腳本:${NC}    /opt/WinkGo/start-winkgo.sh"
    echo ""

    if [[ "${MODE}" == "headless" ]]; then
        echo -e "  ${BOLD}🖥️  Headless 模式使用方式:${NC}"
        echo ""
        echo "    # 使用管理腳本"
        echo "    /opt/WinkGo/start-winkgo.sh start"
        echo "    /opt/WinkGo/start-winkgo.sh status"
        echo "    /opt/WinkGo/start-winkgo.sh stop"
        echo ""
        if command -v systemctl &>/dev/null; then
            echo "    # 或使用 systemd"
            echo "    sudo systemctl start winkgo"
            echo "    sudo systemctl enable winkgo  # 開機自啟"
            echo ""
        fi
        echo "    # WebUI 預設監聽 http://localhost:25808"
        echo ""
    else
        echo -e "  ${BOLD}🖥️  桌面模式使用方式:${NC}"
        echo ""
        echo "    # 直接啟動（桌面環境）"
        echo "    WinkGo"
        echo ""
        echo "    # 或從應用程式選單尋找 WINK GO"
        echo ""
    fi

    echo -e "  ${BOLD}📖 文件:${NC}  https://github.com/WINKGO/wink-go"
    echo -e "  ${BOLD}🐛 回報:${NC}  https://github.com/WINKGO/wink-go/issues"
    echo ""

    if [[ "${MODE}" == "headless" ]]; then
        echo -e "  ${YELLOW}💡 提示:${NC}"
        echo "     • 設定工作目錄: export WINKGO_WORKDIR=/path/to/workspace"
        echo "     • 遠端存取方式: SSH 隧道 / ngrok / 直接開放 25808 端口"
        echo "     • 詳細指南: docs/guides/deploy-server.md"
        echo ""
    fi
}

# ─── 主流程 ───────────────────────────────────────────────────────────────────
main() {
    banner

    # 安裝模式：headless (預設) 或 desktop
    MODE="${WINKGO_MODE:-headless}"
    info "安裝模式: ${BOLD}$MODE${NC}"

    # Step 1: 前置檢查
    check_prerequisites

    # Step 2: 偵測架構
    detect_arch

    # Step 3: 取得版本號
    resolve_version

    # Step 4: 下載
    download_deb

    # Step 5: 安裝
    install_deb

    # Step 6: 根據模式安裝額外元件
    if [[ "$MODE" == "headless" ]]; then
        install_headless_deps
        create_service_script
        create_service_account
        create_systemd_service
    fi

    # Step 7: 桌面捷徑（兩種模式都建立）
    create_desktop_entry

    # 完成！
    print_summary
}

# 執行
main "$@"
