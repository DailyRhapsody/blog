#!/usr/bin/env bash
# DailyRhapsody 防抓取边界用例冒烟测试
# 用法: BASE_URL=http://localhost:3000 bash scripts/qa/edge_probe.sh
# 退出码: 0 全绿; 1 有失败用例
#
# 覆盖范围 (15 个用例):
#   T1-T3:  Phase 1 基础回归
#   T4-T8:  Phase 2 白名单 + 子网粒度
#   T9-T15: Phase 2.5 (本轮) 分享卡片 + 收紧后的 RSS 正则 + IPv6 子网

set -u
B="${BASE_URL:-http://localhost:3000}"
TMP="$(mktemp -d)"
trap "rm -rf $TMP" EXIT

PASS=0
FAIL=0
FAILED_CASES=()

# ANSI
GREEN="\033[32m"; RED="\033[31m"; DIM="\033[2m"; NC="\033[0m"

case_pass() {
  printf "  ${GREEN}✅${NC} %s\n" "$1"
  PASS=$((PASS+1))
}

case_fail() {
  printf "  ${RED}❌${NC} %s\n" "$1"
  FAIL=$((FAIL+1))
  FAILED_CASES+=("$1")
}

run_case() {
  local name="$1"; shift
  local expect="$1"; shift   # "签发seed" / "拒签seed" / "状态码=NNN"
  local desc="$1"; shift
  echo
  echo "[$name] $desc"
  echo -e "  ${DIM}期望: $expect${NC}"
}

# 用 curl 抓首页响应头 + Cookie
fetch_root() {
  local out_file="$1"; shift
  curl -s -o /dev/null -D "$out_file" "$@" "$B/"
}

has_seed() { grep -qi "set-cookie:.*dr_seed=" "$1"; }

# ───────────────────────────────────────────
# Phase 1 回归
# ───────────────────────────────────────────
echo "================ Phase 1 回归 ================"

run_case T1 "签发 dr_seed" "curl 默认无 sec-fetch (兼容 Safari 隐私/PWA/WebView)"
fetch_root "$TMP/h1"
has_seed "$TMP/h1" && case_pass "T1" || case_fail "T1: 未签发 dr_seed"

run_case T2 "拒签 dr_seed" "Sec-Fetch-Dest: image (显式子资源)"
fetch_root "$TMP/h2" -H "Sec-Fetch-Dest: image"
has_seed "$TMP/h2" && case_fail "T2: 误签 dr_seed" || case_pass "T2"

run_case T3 "状态码=403" "受保护 API 无 dr_gate"
code=$(curl -s -o /dev/null -w "%{http_code}" "$B/api/diaries")
[ "$code" = "403" ] && case_pass "T3" || case_fail "T3: 实际 $code"

# ───────────────────────────────────────────
# Phase 2 白名单 + 子网
# ───────────────────────────────────────────
echo
echo "================ Phase 2 白名单 + 子网 ================"

run_case T4 "签发 dr_seed" "Googlebot UA (SEO 友好)"
fetch_root "$TMP/h4" \
  -H "User-Agent: Mozilla/5.0 (compatible; Googlebot/2.1)" \
  -H "Sec-Fetch-Dest: document"
has_seed "$TMP/h4" && case_pass "T4" || case_fail "T4: Googlebot 被误拦"

run_case T5 "签发 dr_seed" "Bingbot UA"
fetch_root "$TMP/h5" \
  -H "User-Agent: Mozilla/5.0 (compatible; bingbot/2.0)"
has_seed "$TMP/h5" && case_pass "T5" || case_fail "T5: Bingbot 被误拦"

run_case T6 "签发 dr_seed" "Feedly RSS UA"
fetch_root "$TMP/h6" \
  -H "User-Agent: Feedly/1.0 (like FeedFetcher-Google)"
has_seed "$TMP/h6" && case_pass "T6" || case_fail "T6: Feedly 被误拦"

run_case T7 "状态码=403" "python-requests UA 仍被拦"
code=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "User-Agent: python-requests/2.31.0" \
  "$B/api/diaries")
[ "$code" = "403" ] && case_pass "T7" || case_fail "T7: 实际 $code"

run_case T8a "复用旧 seed" "同 IPv4 /24 切换 IP"
SEED=$(curl -s -D - -H "X-Forwarded-For: 1.2.3.10" "$B/" \
  | awk -F'[=;]' '/[Ss]et-[Cc]ookie:.*dr_seed=/{print $2; exit}')
[ -z "$SEED" ] && { case_fail "T8a: 拿不到初始 seed"; SEED="dummy"; }
RESP=$(curl -s -D - -H "X-Forwarded-For: 1.2.3.50" -H "Cookie: dr_seed=$SEED" "$B/" | head -40)
echo "$RESP" | grep -qi "set-cookie:.*dr_seed=" && case_fail "T8a: 同/24 被强制刷新" || case_pass "T8a"

run_case T8b "强制刷新 seed" "跨 IPv4 /24"
RESP2=$(curl -s -D - -H "X-Forwarded-For: 9.8.7.6" -H "Cookie: dr_seed=$SEED" "$B/" | head -40)
echo "$RESP2" | grep -qi "set-cookie:.*dr_seed=" && case_pass "T8b" || case_fail "T8b: 跨/24 复用了旧 seed"

# ───────────────────────────────────────────
# Phase 2.5 本轮新增
# ───────────────────────────────────────────
echo
echo "================ Phase 2.5 新增 ================"

run_case T9 "签发 dr_seed" "Bytespider (字节搜索, 中文 SEO)"
fetch_root "$TMP/h9" \
  -H "User-Agent: Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)"
has_seed "$TMP/h9" && case_pass "T9" || case_fail "T9: Bytespider 被误拦"

run_case T10 "签发 dr_seed" "TelegramBot 链接预览"
fetch_root "$TMP/h10" \
  -H "User-Agent: TelegramBot (like TwitterBot)"
has_seed "$TMP/h10" && case_pass "T10" || case_fail "T10: TelegramBot 被误拦"

run_case T11 "签发 dr_seed" "facebookexternalhit OG 抓取"
fetch_root "$TMP/h11" \
  -H "User-Agent: facebookexternalhit/1.1 (+https://www.facebook.com/externalhit_uatext.php)"
has_seed "$TMP/h11" && case_pass "T11" || case_fail "T11: facebookexternalhit 被误拦"

run_case T12 "签发 dr_seed" "Twitterbot OG 抓取"
fetch_root "$TMP/h12" \
  -H "User-Agent: Twitterbot/1.0"
has_seed "$TMP/h12" && case_pass "T12" || case_fail "T12: Twitterbot 被误拦"

run_case T13 "状态码=403" "伪造 RSS UA: myrss/1.0 (B 修复后必拒)"
code=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "User-Agent: myrss/1.0" \
  "$B/api/diaries")
[ "$code" = "403" ] && case_pass "T13" || case_fail "T13: 伪造 RSS UA 绕过 (实际 $code)"

run_case T14 "状态码=403" "伪造 Atom UA: atom-grabber"
code=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "User-Agent: atom-grabber/0.1" \
  "$B/api/diaries")
[ "$code" = "403" ] && case_pass "T14" || case_fail "T14: 伪造 Atom UA 绕过 (实际 $code)"

run_case T15a "复用旧 seed" "同 IPv6 /48 切换地址 (压缩形式)"
SEED6=$(curl -s -D - -H "X-Forwarded-For: 2001:db8:abcd::1" "$B/" \
  | awk -F'[=;]' '/[Ss]et-[Cc]ookie:.*dr_seed=/{print $2; exit}')
[ -z "$SEED6" ] && { case_fail "T15a: 拿不到 IPv6 初始 seed"; SEED6="dummy"; }
RESP=$(curl -s -D - -H "X-Forwarded-For: 2001:db8:abcd:ffff::99" -H "Cookie: dr_seed=$SEED6" "$B/" | head -40)
echo "$RESP" | grep -qi "set-cookie:.*dr_seed=" && case_fail "T15a: 同 IPv6 /48 被强制刷新 (B fix 失败)" || case_pass "T15a"

run_case T15b "强制刷新 seed" "跨 IPv6 /48"
RESP=$(curl -s -D - -H "X-Forwarded-For: 2001:db8:dead::1" -H "Cookie: dr_seed=$SEED6" "$B/" | head -40)
echo "$RESP" | grep -qi "set-cookie:.*dr_seed=" && case_pass "T15b" || case_fail "T15b: 跨 IPv6 /48 复用了旧 seed"

# ───────────────────────────────────────────
# 汇总
# ───────────────────────────────────────────
echo
echo "================ 汇总 ================"
echo "通过 $PASS / 失败 $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo
  echo "失败用例:"
  for c in "${FAILED_CASES[@]}"; do echo "  - $c"; done
  exit 1
fi
echo -e "${GREEN}全部用例通过${NC}"
exit 0
