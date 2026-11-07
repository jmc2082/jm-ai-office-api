#!/usr/bin/env bash
# Deploy one JM Office CloudFormation stack from your machine.
#
#   ./infra/cloudformation/deploy.sh <github-oidc|dns|data|auth|server>
#   ./infra/cloudformation/deploy.sh ami        # print the current Ubuntu 26.04 amd64 AMI
#
# AWS_PROFILE defaults to jmplutouser2 and AWS_REGION to us-east-2.
# Parameter values come from params/prod.json. BudgetEmail is kept out of git
# (the repo is public): pass BUDGET_EMAIL=... when creating the data stack.
set -euo pipefail
cd "$(dirname "$0")"

export AWS_PROFILE="${AWS_PROFILE:-jmplutouser2}"
export AWS_REGION="${AWS_REGION:-us-east-2}"
name="${1:?usage: deploy.sh <github-oidc|dns|data|auth|server|ami>}"

if [ "$name" = ami ]; then
  aws ssm get-parameter \
    --name /aws/service/canonical/ubuntu/server/26.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
    --query Parameter.Value --output text
  exit 0
fi

case "$name" in
  github-oidc) stack=github-oidc ;;
  dns | data | auth | server) stack="jm-office-$name" ;;
  *) echo "Unknown stack: $name" >&2; exit 1 ;;
esac

overrides=()
while IFS= read -r kv; do overrides+=("$kv"); done < <(
  jq -r --arg s "$name" '.[$s] // {} | to_entries[] | "\(.key)=\(.value)"' params/prod.json
)
if [ "$name" = data ] && [ -n "${BUDGET_EMAIL:-}" ]; then
  overrides+=("BudgetEmail=$BUDGET_EMAIL")
fi

args=(
  --stack-name "$stack"
  --template-file "$name.json"
  --capabilities CAPABILITY_NAMED_IAM
  --no-fail-on-empty-changeset
)
# Everything this project creates carries Project=jm-office (used by the budget).
# The GitHub OIDC provider is shared by the whole account, so it is left untagged.
[ "$name" != github-oidc ] && args+=(--tags Project=jm-office)
[ ${#overrides[@]} -gt 0 ] && args+=(--parameter-overrides "${overrides[@]}")

echo "==> $stack ($AWS_PROFILE, $AWS_REGION)"
aws cloudformation validate-template --template-body "file://$name.json" >/dev/null
aws cloudformation deploy "${args[@]}"
aws cloudformation describe-stacks --stack-name "$stack" \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table
