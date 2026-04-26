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

# ───────────────────────────────────────────
# 测试前置：清空本地 honeypot（避免反向用例累计触发自动封 IP）
# 仅在配置了 KV 时执行
# ───────────────────────────────────────────
if [ -f .env.local ]; then
  KV_URL=$(grep "^KV_REST_API_URL=" .env.local 2>/dev/null | cut -d= -f2- | tr -d '"')
  KV_TOKEN=$(grep "^KV_REST_API_TOKEN=" .env.local 2>/dev/null | cut -d= -f2- | tr -d '"')
  if [ -n "$KV_URL" ] && [ -n "$KV_TOKEN" ]; then
    echo -e "${DIM}[setup] 清空本地 + 真实出口 IP 的 honeypot 残留...${NC}"
    for IP in "::1" "127.0.0.1"; do
      curl -s -X POST "$KV_URL/del/dr:blocked:$IP" -H "Authorization: Bearer $KV_TOKEN" >/dev/null
      curl -s -X POST "$KV_URL/del/dr:viol:$IP" -H "Authorization: Bearer $KV_TOKEN" >/dev/null
    done
    REAL_IP=$(curl -s --max-time 3 "https://api.ipify.org" 2>/dev/null)
    if [ -n "$REAL_IP" ]; then
      curl -s -X POST "$KV_URL/del/dr:blocked:$REAL_IP" -H "Authorization: Bearer $KV_TOKEN" >/dev/null
      curl -s -X POST "$KV_URL/del/dr:viol:$REAL_IP" -H "Authorization: Bearer $KV_TOKEN" >/dev/null
    fi
  fi
fi

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

run_case T8a "复用旧 seed (仅本地 dev)" "同 IPv4 /24 切换 IP；线上 Vercel 模式忽略 X-Forwarded-For 自动跳过"
# 线上 IP_TRUSTED_PROXY=vercel，仅读 x-vercel-forwarded-for（攻击者写不进），
# X-Forwarded-For 不再被信任 → 测试场景在线上无意义。
if [[ "$B" =~ localhost|127\.0\.0\.1 ]]; then
  SEED=$(curl -s -D - -H "X-Forwarded-For: 1.2.3.10" "$B/" \
    | awk -F'[=;]' '/[Ss]et-[Cc]ookie:.*dr_seed=/{print $2; exit}')
  [ -z "$SEED" ] && { case_fail "T8a: 拿不到初始 seed"; SEED="dummy"; }
  RESP=$(curl -s -D - -H "X-Forwarded-For: 1.2.3.50" -H "Cookie: dr_seed=$SEED" "$B/" | head -40)
  echo "$RESP" | grep -qi "set-cookie:.*dr_seed=" && case_fail "T8a: 同/24 被强制刷新" || case_pass "T8a"
else
  echo "  ${DIM}(线上 vercel 模式跳过){NC}" 2>/dev/null || echo "  (线上 vercel 模式跳过)"
  case_pass "T8a (skipped)"
fi

run_case T8b "强制刷新 seed (仅本地 dev)" "跨 IPv4 /24"
if [[ "$B" =~ localhost|127\.0\.0\.1 ]]; then
  RESP2=$(curl -s -D - -H "X-Forwarded-For: 9.8.7.6" -H "Cookie: dr_seed=$SEED" "$B/" | head -40)
  echo "$RESP2" | grep -qi "set-cookie:.*dr_seed=" && case_pass "T8b" || case_fail "T8b: 跨/24 复用了旧 seed"
else
  case_pass "T8b (skipped)"
fi

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

run_case T15a "复用旧 seed (仅本地 dev)" "同 IPv6 /48 切换地址 (压缩形式)"
if [[ "$B" =~ localhost|127\.0\.0\.1 ]]; then
  SEED6=$(curl -s -D - -H "X-Forwarded-For: 2001:db8:abcd::1" "$B/" \
    | awk -F'[=;]' '/[Ss]et-[Cc]ookie:.*dr_seed=/{print $2; exit}')
  [ -z "$SEED6" ] && { case_fail "T15a: 拿不到 IPv6 初始 seed"; SEED6="dummy"; }
  RESP=$(curl -s -D - -H "X-Forwarded-For: 2001:db8:abcd:ffff::99" -H "Cookie: dr_seed=$SEED6" "$B/" | head -40)
  echo "$RESP" | grep -qi "set-cookie:.*dr_seed=" && case_fail "T15a: 同 IPv6 /48 被强制刷新 (B fix 失败)" || case_pass "T15a"
else
  case_pass "T15a (skipped)"
fi

run_case T15b "强制刷新 seed (仅本地 dev)" "跨 IPv6 /48"
if [[ "$B" =~ localhost|127\.0\.0\.1 ]]; then
  RESP=$(curl -s -D - -H "X-Forwarded-For: 2001:db8:dead::1" -H "Cookie: dr_seed=$SEED6" "$B/" | head -40)
  echo "$RESP" | grep -qi "set-cookie:.*dr_seed=" && case_pass "T15b" || case_fail "T15b: 跨 IPv6 /48 复用了旧 seed"
else
  case_pass "T15b (skipped)"
fi

# ───────────────────────────────────────────
# Phase 3: 安全 Blocker 反向用例（A1 / A3）
# ───────────────────────────────────────────
echo
echo "================ Phase 3 安全反向 ================"

run_case T16 "状态码=403" "伪造 admin_session 不能绕过 middleware"
# 构造一个 base64 payload + 任意 64 字符的 sig
FAKE_PAYLOAD=$(python3 -c 'import base64,json; p=json.dumps({"admin":True,"exp":99999999999999}); print(base64.urlsafe_b64encode(p.encode()).rstrip(b"=").decode())' 2>/dev/null)
FAKE_COOKIE="admin_session=${FAKE_PAYLOAD}.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
code=$(curl -s -o /dev/null -w "%{http_code}" -H "Cookie: $FAKE_COOKIE" "$B/api/diaries")
[ "$code" = "403" ] && case_pass "T16" || case_fail "T16: 伪造 admin 通过了 middleware (实际 $code)"

run_case T17 "状态码=401" "/api/revalidate POST 无 Authorization 头"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$B/api/revalidate")
[ "$code" = "401" ] && case_pass "T17" || case_fail "T17: 实际 $code"

run_case T18 "状态码=401" "/api/revalidate query secret 不再生效"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$B/api/revalidate?secret=anything")
[ "$code" = "401" ] && case_pass "T18" || case_fail "T18: 实际 $code"

run_case T19 "状态码=200" "/api/revalidate GET 仅返回健康检查（不再触发清缓存）"
RESP=$(curl -s -w "\n%{http_code}" "$B/api/revalidate")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -1)
if [ "$CODE" = "200" ] && echo "$BODY" | grep -q "POST with Authorization"; then
  case_pass "T19"
else
  case_fail "T19: code=$CODE body=$BODY"
fi

# ───────────────────────────────────────────
# Phase 4: same-origin 反向用例（A12）+ analytics 静默（A10）
# 注意：T22 放最前面跑，因为反向用例累计会触发 honeypot 自动封 IP（4 次/10min）
# ───────────────────────────────────────────
echo
echo "================ Phase 4 写操作 CSRF + analytics 204 ================"

# 在跑 T22 前再次清空 honeypot（前面 Phase 2-3 有多个反向用例 ≥4 次累计触发自动封）
if [ -n "${KV_URL:-}" ] && [ -n "${KV_TOKEN:-}" ]; then
  # 本地 IP
  for IP in "::1" "127.0.0.1"; do
    curl -s -X POST "$KV_URL/del/dr:blocked:$IP" -H "Authorization: Bearer $KV_TOKEN" >/dev/null
    curl -s -X POST "$KV_URL/del/dr:viol:$IP" -H "Authorization: Bearer $KV_TOKEN" >/dev/null
  done
  # 真实出口 IP（线上跑时 testing client 真实 IP 也可能被自己累计触发自封）
  REAL_IP=$(curl -s --max-time 3 "https://api.ipify.org" 2>/dev/null)
  if [ -n "$REAL_IP" ]; then
    curl -s -X POST "$KV_URL/del/dr:blocked:$REAL_IP" -H "Authorization: Bearer $KV_TOKEN" >/dev/null
    curl -s -X POST "$KV_URL/del/dr:viol:$REAL_IP" -H "Authorization: Bearer $KV_TOKEN" >/dev/null
  fi
fi

run_case T22 "状态码=204" "POST /api/analytics/collect 无 dr_gate 时静默 204（不再 403）"
# 用真人 UA 避开 middleware bot UA 检查；
# 不带 dr_gate cookie 时 route 内部 verifyGateValue 失败应静默返回 204（之前是 403）
code=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15" \
  -X POST -H "Content-Type: application/json" -d "{}" "$B/api/analytics/collect")
if [ "$code" = "204" ]; then
  case_pass "T22"
elif [ "$code" = "403" ]; then
  case_fail "T22: 403 (本地 honeypot 残留 dr:blocked:::1，需手动清 Redis)"
else
  case_fail "T22: 实际 $code"
fi

run_case T20 "状态码=403" "POST /api/auth/login 缺 Origin/Referer 双缺失"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "{}" "$B/api/auth/login")
[ "$code" = "403" ] && case_pass "T20" || case_fail "T20: 实际 $code"

run_case T21 "状态码=403 或 404" "POST 伪造 Host: evil.com + Origin: evil.com"
# 本地 dev: middleware 同源校验 → 403
# 线上 Vercel: Host 路由决定 vhost，evil.com 未注册到项目 → 404（Vercel 边缘拒绝），更早更彻底
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Host: evil.com" -H "Origin: https://evil.com" -H "Content-Type: application/json" -d "{}" "$B/api/auth/login")
if [ "$code" = "403" ] || [ "$code" = "404" ]; then case_pass "T21"; else case_fail "T21: 实际 $code"; fi

# ───────────────────────────────────────────
# 汇总
# ───────────────────────────────────────────
echo
echo "================ 汇总 ================"
echo "通过 $PASS / 失败 $FAIL"

# Teardown: 清掉本次跑测试期间累计的 honeypot 封禁，避免影响后续真人访问
if [ -n "${KV_URL:-}" ] && [ -n "${KV_TOKEN:-}" ]; then
  for IP in "::1" "127.0.0.1"; do
    curl -s -X POST "$KV_URL/del/dr:blocked:$IP" -H "Authorization: Bearer $KV_TOKEN" >/dev/null
    curl -s -X POST "$KV_URL/del/dr:viol:$IP" -H "Authorization: Bearer $KV_TOKEN" >/dev/null
  done
  REAL_IP=$(curl -s --max-time 3 "https://api.ipify.org" 2>/dev/null)
  if [ -n "$REAL_IP" ]; then
    curl -s -X POST "$KV_URL/del/dr:blocked:$REAL_IP" -H "Authorization: Bearer $KV_TOKEN" >/dev/null
    curl -s -X POST "$KV_URL/del/dr:viol:$REAL_IP" -H "Authorization: Bearer $KV_TOKEN" >/dev/null
  fi
fi

if [ "$FAIL" -gt 0 ]; then
  echo
  echo "失败用例:"
  for c in "${FAILED_CASES[@]}"; do echo "  - $c"; done
  exit 1
fi
echo -e "${GREEN}全部用例通过${NC}"
exit 0
