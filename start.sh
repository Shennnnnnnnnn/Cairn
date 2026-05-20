#!/usr/bin/env bash
# Cairn startup script
# Usage:
#   ./start.sh            — start both server and dispatcher (default)
#   ./start.sh server     — start server only
#   ./start.sh dispatch   — start dispatcher only
#   ./start.sh healthcheck — run startup healthcheck and exit
#   ./start.sh summary-backfill — run dispatcher with inactive-project summary backfill enabled

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${CAIRN_CONFIG:-${SCRIPT_DIR}/dispatch.yaml}"
HOST="${CAIRN_HOST:-127.0.0.1}"
PORT="${CAIRN_PORT:-8000}"
LOG_LEVEL="${CAIRN_LOG_LEVEL:-info}"

UV_RUN="uv run --project ${SCRIPT_DIR}/cairn"

# ── helpers ──────────────────────────────────────────────────────────────────

log() { echo "[cairn] $*"; }

check_config() {
    if [[ ! -f "$CONFIG" ]]; then
        echo "Error: config file not found: $CONFIG"
        echo "Set CAIRN_CONFIG or place dispatch.yaml in the project root."
        exit 1
    fi
}

wait_for_server() {
    local url="http://${HOST}:${PORT}/docs"
    log "Waiting for server at ${url} ..."
    for i in $(seq 1 30); do
        if curl -sf "$url" > /dev/null 2>&1; then
            log "Server is up."
            return 0
        fi
        sleep 1
    done
    echo "Error: server did not become ready within 30 seconds."
    exit 1
}

start_server() {
    log "Starting Cairn server on ${HOST}:${PORT} ..."
    $UV_RUN cairn serve \
        --host "$HOST" \
        --port "$PORT" \
        --log-level "$LOG_LEVEL"
}

start_dispatcher() {
    check_config
    log "Starting Cairn dispatcher (config: ${CONFIG}) ..."
    $UV_RUN cairn dispatch --config "$CONFIG"
}

start_all() {
    check_config

    # Start server in background
    log "Starting Cairn server on ${HOST}:${PORT} ..."
    $UV_RUN cairn serve \
        --host "$HOST" \
        --port "$PORT" \
        --log-level "$LOG_LEVEL" &
    SERVER_PID=$!

    # Trap to kill both processes on exit
    trap 'log "Shutting down..."; kill $SERVER_PID 2>/dev/null; exit 0' INT TERM

    wait_for_server

    # Start dispatcher in foreground
    log "Starting Cairn dispatcher (config: ${CONFIG}) ..."
    $UV_RUN cairn dispatch --config "$CONFIG" &
    DISPATCHER_PID=$!

    trap 'log "Shutting down..."; kill $SERVER_PID $DISPATCHER_PID 2>/dev/null; exit 0' INT TERM

    # Poll until either process exits
    while kill -0 $SERVER_PID 2>/dev/null && kill -0 $DISPATCHER_PID 2>/dev/null; do
        sleep 1
    done
    log "A process exited. Shutting down remaining processes..."
    kill $SERVER_PID $DISPATCHER_PID 2>/dev/null || true
}

run_healthcheck() {
    check_config
    log "Running startup healthcheck (config: ${CONFIG}) ..."
    $UV_RUN cairn dispatch --config "$CONFIG" --startup-healthcheck-only
}

run_summary_backfill() {
    check_config
    log "Starting Cairn dispatcher with summary backfill enabled (config: ${CONFIG}) ..."
    $UV_RUN cairn dispatch --config "$CONFIG" --summary-backfill
}

# ── main ─────────────────────────────────────────────────────────────────────

MODE="${1:-all}"

case "$MODE" in
    all)        start_all ;;
    server)     start_server ;;
    dispatch)   start_dispatcher ;;
    healthcheck) run_healthcheck ;;
    summary-backfill) run_summary_backfill ;;
    *)
        echo "Usage: $0 [all|server|dispatch|healthcheck|summary-backfill]"
        echo ""
        echo "  all          Start server + dispatcher (default)"
        echo "  server       Start server only"
        echo "  dispatch     Start dispatcher only"
        echo "  healthcheck  Run startup healthcheck and exit"
        echo "  summary-backfill  Start dispatcher and also fill inactive project summaries"
        echo ""
        echo "Environment variables:"
        echo "  CAIRN_CONFIG     Path to dispatch.yaml  (default: ./dispatch.yaml)"
        echo "  CAIRN_HOST       Server bind host        (default: 127.0.0.1)"
        echo "  CAIRN_PORT       Server bind port        (default: 8000)"
        echo "  CAIRN_LOG_LEVEL  Log level               (default: info)"
        exit 1
        ;;
esac
