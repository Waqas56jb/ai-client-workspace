#!/usr/bin/env bash
# Deploys the API to the EC2 instance (no SSH): package → S3 → SSM Run Command.
# Needs AWS credentials in the environment. Config comes from the SecureString
# parameter /studioflow/env (never from this repo).
#   INSTANCE=i-… DEPLOY_BUCKET=… bash aws/deploy-api.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
: "${INSTANCE:?}" "${DEPLOY_BUCKET:?}"
REGION=${AWS_REGION:-ap-southeast-2}
mkdir -p .deploy && PKG=.deploy/api.tgz
tar czf "$PKG" --exclude=node_modules --exclude=tests --exclude='.env*' --exclude=aws package.json package-lock.json src scripts supabase
aws s3 cp "$PKG" "s3://$DEPLOY_BUCKET/api.tgz" --region "$REGION" --only-show-errors

cat > "$(dirname "$PKG")/cmd.json" <<JSON
{"commands":[
"set -e",
"aws s3 cp s3://$DEPLOY_BUCKET/api.tgz /tmp/api.tgz --region $REGION --only-show-errors",
"rm -rf /opt/studioflow/next && mkdir -p /opt/studioflow/next && tar xzf /tmp/api.tgz -C /opt/studioflow/next",
"cd /opt/studioflow/next && npm ci --omit=dev --no-audit --no-fund --loglevel=error",
"aws ssm get-parameter --name /studioflow/env --with-decryption --region $REGION --query Parameter.Value --output text > /etc/studioflow.env && chmod 600 /etc/studioflow.env",
"rm -rf /opt/studioflow/prev && if [ -d /opt/studioflow/app ]; then mv /opt/studioflow/app /opt/studioflow/prev; fi && mv /opt/studioflow/next /opt/studioflow/app && chown -R studioflow:studioflow /opt/studioflow",
"systemctl restart studioflow && sleep 5",
"curl -fsS -H \"x-origin-verify: \$(grep '^ORIGIN_SECRET=' /etc/studioflow.env | cut -d= -f2-)\" http://localhost:8080/api/v1/health/ready || (journalctl -u studioflow -n 40 --no-pager; exit 1)"
]}
JSON
CMD=$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE" --document-name AWS-RunShellScript --parameters "file://$(dirname "$PKG")/cmd.json" --timeout-seconds 600 --query Command.CommandId --output text)
echo "deploying ($CMD)…"
aws ssm wait command-executed --region "$REGION" --command-id "$CMD" --instance-id "$INSTANCE" || true
aws ssm get-command-invocation --region "$REGION" --command-id "$CMD" --instance-id "$INSTANCE" --query '[Status,StandardOutputContent,StandardErrorContent]' --output text | tail -40
