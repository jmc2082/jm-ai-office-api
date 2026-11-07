# Phase 0c: CloudFormation plan for the EC2 box

Created: 2026-11-05
Status: Deployed 2026-11-06/07. API live at https://api.office.wikiboost.com, dashboard at
https://office.wikiboost.com (Amplify, published by the frontend repo's GitHub Actions).

One EC2 instance runs Caddy, the NestJS API and Litestream in Docker, with SQLite on its
disk. All of it is CloudFormation (JSON), deployed with the AWS CLI. The files are in
[`infra/`](../../infra/).

---

## 1. Decisions

| Topic | Decision |
|---|---|
| Instance | **t3.micro** (x86, 2 vCPU, 1 GiB) with 2 GB swap. CPU credits set to `standard`, so a busy box is slowed down rather than billed extra. |
| OS | Ubuntu Server 26.04 LTS amd64, AMI pinned in `params/prod.json` (`ami-0e1011556f696c3d3`, built 2026-11-04) |
| Account / region | Profile `jmplutouser2`, account 218334699468, **us-east-2** |
| API address | `https://api.office.wikiboost.com` (Elastic IP, Let's Encrypt certificate through Caddy) |
| DNS | Route 53 zone `office.wikiboost.com`, delegated from Namecheap with 4 NS records. `wikiboost.com` itself stays at Namecheap. |
| Access to the box | SSM Session Manager only. No SSH port and no key pair. |
| Image builds | GitHub Actions → ECR, then an SSM command tells the box to pull. The repo is public, so Actions minutes on standard runners cost nothing. |
| Budget | $25/month, counting **only resources tagged `Project=jm-office`** (see §3) |
| Secrets | SSM Parameter Store. CloudFormation creates the plain settings; the Anthropic key is a SecureString you set from the CLI. |

## 2. Cost (us-east-2, on-demand; check the AWS pricing pages)

| Item | ~$/month |
|---|---|
| t3.micro ($0.0104/h) | 7.60 |
| Public IPv4 / Elastic IP ($0.005/h) | 3.65 |
| EBS gp3, 20 GB | 1.60 |
| Route 53 hosted zone | 0.50 |
| S3 + ECR | < 0.20 |
| **Total** | **~13.50** |

**Free tier:** this account's 12-month free tier has **already ended**. The account is from
before July 2025, so the 12 months ran out by mid-2026, and `aws freetier
get-free-tier-usage` now lists only "Always Free" items. The t3.micro will be billed.

For reference, t4g.micro (ARM) is about $1.50/month cheaper, but it would need an arm64 AMI
and an arm64 image build. Switching is easiest before the first deploy. After that it
means replacing the instance, and the database is restored from S3.

## 3. Budget scoped by tag

The account already spends about **$43–60/month** on other projects (Aug–Oct 2026). A $25
budget for the whole account would alert straight away, so the budget filters on the cost
allocation tag `Project=jm-office`. `deploy.sh` adds that tag to every jm-office stack, and
CloudFormation copies it onto the resources.

AWS only offers a tag as a cost allocation tag after it has seen it on resources, which can
take up to 24 hours. **The budget reads $0 until the tag is activated** (step 9 below).

---

## 4. Stacks

Long-lived pieces have their own stacks, so replacing or deleting the server never touches
DNS, backups or users.

| Stack | Template | Contents |
|---|---|---|
| `github-oidc` | `github-oidc.json` | GitHub Actions identity provider. An account can only have one, so it isn't tied to this project. |
| `jm-office-dns` | `dns.json` | Hosted zone `office.wikiboost.com` (Retain). Outputs the NS values for Namecheap. |
| `jm-office-data` | `data.json` | S3 bucket `jm-office-<account>-us-east-2` (`litestream/` + `releases/`, versioned, private, Retain), ECR repo `jm-office-api` (immutable tags, keeps the last 10), budget |
| `jm-office-auth` | `auth.json` | Cognito user pool (admin-created users only, deletion protection) + SPA client (SRP, no secret). Writes `COGNITO_*` to SSM. |
| `jm-office-server` | `server.json` | VPC/subnet/IGW, security group (80, 443 only), instance role, EC2 + bootstrap, Elastic IP, `api.` A record, app settings in SSM, `jm-office-deploy` SSM document, GitHub deploy role |
| `jm-office-web` | `web.json` | Amplify app `jm-office-web` (no Git connection; SPA rewrite), branch `main`, custom domain `office.wikiboost.com` (Amplify adds the Route 53 records and certificate itself), and the deploy role for the frontend repo's GitHub Actions |

**Why auth comes before server:** the API refuses to start in production without
`COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID` (`AUTH_DISABLED` is blocked there), so those
SSM parameters must exist before the first release.

### What runs on the box

```
/opt/jm-office/
├── data/                 # office.db (uid 1000, shared by the API and Litestream)
├── shared/app.env        # written on each deploy from SSM /jm-office/prod/app/*
├── releases/<sha>/       # infra/host bundle for each release (last 5 kept)
└── current -> releases/<sha>
```

`infra/host/docker-compose.yml` runs four services:

1. `restore`: a one-shot job that pulls the latest database from S3, but only if there's
   no local database.
2. `api`: the NestJS API.
3. `litestream`: continuous replication to S3. It keeps 7 days and takes a snapshot daily.
4. `caddy`: TLS and the reverse proxy. It has no access log and no compression, because of
   the SSE token in the query string and SSE buffering.

### Things that replace the instance (and its disk)

- Changing `ImageId` (moving to a new Ubuntu AMI)
- Changing the launch template (it only holds the IMDSv2 settings)
- A change in architecture

A new instance has no app running until you **re-run the "Deploy API" workflow**. On that
first start, `restore` brings the database back from S3.

Changing `InstanceType` within t3 is a stop/start, and the disk is kept.

---

## 5. Rollout

All commands run from the API repo root. The profile and region default to `jmplutouser2` /
`us-east-2`.

1. **GitHub identity provider**
   ```bash
   ./infra/cloudformation/deploy.sh github-oidc
   ```
2. **DNS**
   ```bash
   ./infra/cloudformation/deploy.sh dns
   ```
   In Namecheap, go to wikiboost.com → Advanced DNS and add 4 **NS records**, host
   `office`, one for each name server in the output. Wait until this shows them:
   ```bash
   dig +short NS office.wikiboost.com
   ```
3. **Data.** The email is passed in rather than committed, because the repo is public:
   ```bash
   BUDGET_EMAIL=you@example.com ./infra/cloudformation/deploy.sh data
   ```
4. **Auth**, then create your user:
   ```bash
   ./infra/cloudformation/deploy.sh auth
   aws cognito-idp admin-create-user --profile jmplutouser2 --region us-east-2 \
     --user-pool-id <UserPoolId> --username you@example.com \
     --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true
   ```
5. **Anthropic key.** Only needed once `AiMode` is switched to `live`; the box starts in
   `mock`:
   ```bash
   aws ssm put-parameter --profile jmplutouser2 --region us-east-2 --type SecureString \
     --name /jm-office/prod/app/ANTHROPIC_API_KEY --value 'sk-ant-…'
   ```
6. **Server.** This takes about 5–10 minutes, and the stack waits until the bootstrap
   reports success:
   ```bash
   ./infra/cloudformation/deploy.sh server
   ```
7. **GitHub variable** for the deploy role:
   ```bash
   gh variable set AWS_DEPLOY_ROLE_ARN -R jmc2082/jm-ai-office-api --body <DeployRoleArn>
   ```
8. **First release.** Merge `dev` into `main`, or run Actions → Deploy API on `main`. Then
   check:
   ```bash
   curl https://api.office.wikiboost.com/api/health
   ```
9. **About a day later, activate the cost tag** so the budget starts counting:
   ```bash
   aws ce update-cost-allocation-tags-status --profile jmplutouser2 --region us-east-1 \
     --cost-allocation-tags-status TagKey=Project,Status=Active
   ```

**Shell on the box:**
`aws ssm start-session --profile jmplutouser2 --region us-east-2 --target <InstanceId>`.
This needs the Session Manager plugin for the AWS CLI on your Mac.

**Bootstrap log on the box:** `/var/log/jm-office-bootstrap.log`.

---

## 6. Still open / next

- **Frontend login.** `authService.getAccessToken()` still returns `null`, so the deployed
  dashboard can't call the production API yet. Next step: Cognito SRP sign-in in the Vue
  app, plus Amplify hosting at `office.wikiboost.com`, which becomes a record in the
  delegated zone.
- **`needs` CLI** (roadmap 0c).
- **OS updates.** Ubuntu's `unattended-upgrades` installs security updates but doesn't
  reboot. Reboot after kernel updates; the containers come back on their own.
- **Rollback.** A failed health check fails the workflow, and the previous containers are
  already stopped by then. To roll back, re-run the workflow for an earlier commit.
