#!/usr/bin/env bash
# Builds the frontend for the AWS deployment and publishes it: S3 (private) → CloudFront.
#   WEB_BUCKET=… DIST=… CF_DOMAIN=… bash aws/deploy-web.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/../../client"
: "${WEB_BUCKET:?}" "${DIST:?}" "${CF_DOMAIN:?}"
VITE_AUTH_MODE=local VITE_API_BASE_URL="https://$CF_DOMAIN/api/v1" VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir dist-aws
# hashed assets are immutable; index.html must always be revalidated so a deploy shows at once
aws s3 sync dist-aws "s3://$WEB_BUCKET" --delete --exclude index.html --cache-control "public,max-age=31536000,immutable" --only-show-errors
aws s3 cp dist-aws/index.html "s3://$WEB_BUCKET/index.html" --cache-control "no-cache" --content-type "text/html; charset=utf-8" --only-show-errors
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/index.html" "/" --query Invalidation.Status --output text
echo "https://$CF_DOMAIN"
