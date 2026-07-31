# Modified from AionUI by WINK GO contributors in 2026.

cat-config:
	@base64 -D -i ~/.winkgo-config-dev/winkgo-config.txt | python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.stdin.read()))' | pbcopy
