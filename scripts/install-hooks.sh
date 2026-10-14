#!/bin/sh
# Install the repository's pre-commit check into this clone.
set -eu
hooks="$(git rev-parse --path-format=absolute --git-common-dir)/hooks"
mkdir -p "$hooks"
cat > "$hooks/pre-commit" <<'EOF'
#!/bin/sh
exec "$(git rev-parse --show-toplevel)/scripts/check-public.sh"
EOF
chmod +x "$hooks/pre-commit"
echo "installed $hooks/pre-commit"
