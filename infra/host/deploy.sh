#!/usr/bin/env bash
# Runs on the EC2 box as root, started by the jm-office-deploy SSM document after it
# copies this release bundle to /opt/jm-office/releases/<tag>/.
#
#   deploy.sh <release-tag>
#
# The SSM document sets: AWS_REGION BUCKET ECR_REPO_URI API_DOMAIN PARAM_PATH
set -euo pipefail

TAG="${1:?usage: deploy.sh <release-tag>}"
: "${AWS_REGION:?}" "${BUCKET:?}" "${ECR_REPO_URI:?}" "${API_DOMAIN:?}" "${PARAM_PATH:?}"

ROOT=/opt/jm-office
DIR="$ROOT/releases/$TAG"
AWS=/usr/local/bin/aws
export HOME="${HOME:-/root}" # SSM commands can run without HOME; docker login needs it.

echo "==> Release $TAG"

# 1. App environment: every parameter under PARAM_PATH becomes NAME=value (SecureStrings decrypted).
umask 077
"$AWS" ssm get-parameters-by-path --region "$AWS_REGION" --path "$PARAM_PATH" \
  --recursive --with-decryption --output json \
  | jq -r '.Parameters[] | "\(.Name | split("/") | last)=\(.Value)"' > "$ROOT/shared/app.env.new"
mv "$ROOT/shared/app.env.new" "$ROOT/shared/app.env"
echo "    settings: $(cut -d= -f1 "$ROOT/shared/app.env" | sort | tr '\n' ' ')"
umask 022

# 2. Variables for docker-compose.yml.
cat > "$DIR/.env" <<EOF
API_IMAGE=$ECR_REPO_URI:$TAG
API_DOMAIN=$API_DOMAIN
BUCKET=$BUCKET
AWS_REGION=$AWS_REGION
EOF

# 3. Pull images.
"$AWS" ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${ECR_REPO_URI%%/*}" >/dev/null
cd "$DIR"
docker compose pull --quiet

# 4. Start. On a fresh box, `restore` pulls the database from S3 first.
docker compose up -d --remove-orphans

# 5. Wait for the API's health check.
api="$(docker compose ps -q api)"
status=starting
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$api" 2>/dev/null || echo missing)"
  [ "$status" = healthy ] && break
  sleep 3
done
if [ "$status" != healthy ]; then
  echo "!! API is $status after 3 minutes. Recent logs:" >&2
  docker compose logs --tail 80 restore api >&2 || true
  exit 1
fi

ln -sfn "$DIR" "$ROOT/current"
echo "==> Healthy. https://$API_DOMAIN/api/health"

# 6. Tidy up: keep the 5 newest release folders and drop unused images.
ls -1dt "$ROOT"/releases/*/ | tail -n +6 | xargs -r rm -rf
docker image prune -af --filter "until=168h" >/dev/null || true
