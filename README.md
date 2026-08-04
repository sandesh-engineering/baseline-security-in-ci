# baseline-security-in-ci

A minimal Node.js + TypeScript REST API that demonstrates a basic automated security pipeline in GitHub Actions. The app is intentionally tiny — the point is the CI pipeline, not the application.

**The question this project answers:** Can a small startup automatically perform basic security checks using free/open-source tools?

## Application

- Node.js + TypeScript + Express
- `GET /health` — health check
- `GET /api/users` — returns an in-memory array of users
- Small unit test (`npm test`)
- Docker multi-stage build that runs as a non-root user

Basic security practices baked into the app:

- **Helmet** — sets secure HTTP headers (X-Content-Type-Options, X-Frame-Options, etc.)
- **JSON body-size limit** — `express.json({ limit: "100kb" })` rejects oversized request bodies
- **Generic production error responses** — no stack traces or internals leaked to clients
- **No secrets in source code** — there are none; `.env` is git-ignored and deleted

## Tools

| Tool           | Purpose                          |
| -------------- | -------------------------------- |
| npm audit      | npm dependency vulnerabilities   |
| Gitleaks       | Secret detection                 |
| Semgrep        | Source-code security analysis    |
| Trivy          | Container vulnerability scanning |
| GitHub Actions | Automation                       |

## CI flow

`.github/workflows/ci.yml` runs on every pull request and push to `main`:

```text
Code
 ↓
npm audit
 ↓
Tests + Build
 ↓
Gitleaks
 ↓
Semgrep
 ↓
Docker build
 ↓
Trivy
 ↓
Remove Docker image
 ↓
Security reports
```

The checks below are gated on the security results:

### npm audit

`npm audit --audit-level=high` checks the npm dependency tree (the packages in `package-lock.json`) against the public npm advisory database.

- **What it does:** compares installed dependency versions to known advisories and reports the affected package, severity, and fixed version.
- **Why it is useful:** a dependency with a known vulnerability can be exploited without any bug in _your_ code. npm audit catches these before they ship.
- **How it differs from Trivy:** npm audit only scans npm packages. Trivy scans the whole OCI container image — OS packages, the base image, language dependencies, and misconfiguration files (if asked).
- **What happens when a vulnerability is found:** the step exits non-zero, so the job (and the pipeline) fails for high/critical findings.
- **How to update the affected dependency:** run `npm audit` to see the advisory, then update the dependency, for example:

  ```bash
  npm install <package>@<fixed-version>
  ```

  or run `npm audit fix` to apply recommended patches automatically, then verify tests still pass.

### Gitleaks

Gitleaks scans the repository's git history for accidentally committed secrets (API keys, tokens, passwords, private keys).

- **What it detects:** high-entropy strings and known secret patterns across every commit in history, not just the files currently on disk.
- **Why secrets should not be committed:** source code is often cloned, forked, mirrored, or shared, and every copy keeps the secret forever.
- **Why deleting a secret from the latest commit is not enough:** the secret still exists in the git history (older commits). Anyone with access can recover it.
- **Why exposed credentials should be rotated/revoked:** if a secret was ever pushed, assume it was compromised. Revoke it and issue a new one, then delete it from history (and even then, rotation is the only real fix).

The pipeline fails if Gitleaks detects a secret. There are no real secrets in this repository.

### Semgrep

Semgrep is a static analysis tool. It runs `semgrep scan --config p/security-audit`, which uses the free, community-maintained security rule set.

- **What SAST means:** Static Application Security Testing — analyzing source code _without executing it_ to find bugs and security issues.
- **What Semgrep checks:** patterns of insecure code: SQL injection, unsafe deserialization, hardcoded credentials, use of dangerous functions, path traversal, and more.
- **Examples of vulnerabilities it can identify:** `child_process.exec` with user input, `eval` of untrusted data, risky `fs` paths, and other common OWASP-style weaknesses.
- **What Semgrep cannot identify:** runtime behavior, secrets already sitting in git history (that's Gitleaks), dependency versions (that's npm audit), or infrastructure/container issues (that's Trivy).
- **Difference between Semgrep and Gitleaks:** Semgrep finds _insecure code patterns_ in how you write code; Gitleaks finds _secrets that were committed_. They scan different things and complement each other.

The step writes a JSON report to `security-reports/semgrep.json` and fails the job if serious findings are present.

### Docker + Trivy

The image is built as:

```text
security-ci-lab:${{ github.sha }}
```

and is **not** pushed to Docker Hub or any registry. Trivy then scans the final image.

**Policy (initial):**

| Severity   | Action                                        |
| ---------- | --------------------------------------------- |
| CRITICAL   | fails CI                                      |
| HIGH       | reported (shown in report)                    |
| MEDIUM/LOW | reported if scanned, not blocking in this lab |

High/critical findings appear in `security-reports/trivy.json`; only CRITICAL findings fail the build (via a small `jq` check on the JSON report).

After the scan, the workflow removes the built image from the runner (`docker rmi security-ci-lab:${{ github.sha }}`) so no image is left behind — it was only needed for the scan. The cleanup runs even if the scan or the critical gate fails (`if: always()`).

**How Docker vulnerabilities are normally fixed:**

```text
Trivy finding
    ↓
Identify source
    ↓
Base image / npm dependency / OS package
    ↓
Update affected component
    ↓
Rebuild image
    ↓
Scan again
```

For example: an Alpine base image CVE → bump the base image tag; a Node package advisory → update the dependency; an OS package → update the image. Then rebuild and rescan. Do **not** blindly suppress findings with ignore files — evaluate each finding, since suppression hides real risk.

## Artifacts

The CI workflow generates:

```text
security-reports/
├── semgrep.json
└── trivy.json
```

and uploads them as a GitHub Actions artifact named `security-reports` with **1-day retention**.

- **How to view/download:** open the Actions tab → select the run → "Artifacts" → download `security-reports`.
- **How to manually delete it:** GitHub → repository → **Settings → Actions → General → Artifact and log retention**, or use the API/UI to delete a specific artifact from a run. (Note: automatic retention is set per-repository in Settings → Actions; current lab setting is 1 day.)
- **Artifacts can also expire automatically:** this workflow sets `retention-days: 1`, so the artifact is deleted automatically after one day.
- **Why so short?** The reports are only needed temporarily to review a concrete run. Long-term storage is unnecessary for this lab.

Docker images are **not** uploaded as artifacts.

## GitHub Release

`.github/workflows/release.yml` triggers when a tag like `v1.0.0` is pushed:

1. Runs the **same security/CI checks** by reusing the `ci.yml` workflow (`workflow_call`) — the release is only created if those checks pass.
2. Installs dependencies and builds the app.
3. Creates a release archive `baseline-security-in-ci-<tag>.tar.gz` from the build output.
4. Creates a GitHub Release.
5. Attaches the archive to the release.

It never deploys anywhere.

**Difference between an Actions artifact and a GitHub Release asset:**

|          | Actions artifact                                  | GitHub Release asset                                      |
| -------- | ------------------------------------------------- | --------------------------------------------------------- |
| Scope    | attached to a workflow _run_, temporary by nature | attached to a _release_, long-lived and permanent-looking |
| Lifetime | governed by retention (here: 1 day)               | stays until deleted                                       |
| Audience | CI debugging/review, usually internal             | intended to be downloaded by users                        |

For this project: artifacts are short-lived scan reports; release assets are the distributable builds.

## Failure handling

| Failure                                     | What the pipeline does                                    | What you do                                                                            |
| ------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| npm audit finds high/critical vulnerability | `npm audit --audit-level=high` exits non-zero → job fails | update the affected dependency (see above), re-run                                     |
| Gitleaks finds a secret                     | action fails the job → pipeline stops                     | **rotate/revoke the exposed secret**, remove it from history, verify with a fresh scan |
| Semgrep finds a serious issue               | step exits non-zero → job fails                           | fix the flagged code pattern in `src/`, re-run                                         |
| Trivy finds a critical image vulnerability  | job fails after the `jq` gate                             | update base image or dependencies, rebuild, rescan; do not blindly suppress            |

## Basic security baseline

- **Non-root Docker container** — the runtime stage creates `appuser` and runs with `USER appuser`.
- **Helmet** — secure HTTP response headers.
- **Request body limit** — stops oversized JSON payloads (DoS mitigation).
- **No secrets in source** — `.env` is git-ignored and deleted; nothing sensitive is committed.
- **Least-privilege GitHub Actions permissions** — CI runs with `permissions: contents: read`; only the release job is granted `contents: write`, and only to create the GitHub Release. No `write-all` anywhere.

## GitHub Actions cost

GitHub provides a free allowance for private repositories on GitHub Free for organizations. Per the official documentation (always check the current numbers and terms at <https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions>):

- **2,000 GitHub-hosted runner minutes/month** included for private repositories (free tier for organizations).
- **500 MB of artifact storage** included for private repositories.
- **Public repositories:** GitHub Actions are free — workflows in public repositories consume the included minutes and storage but are not billed to the private-repository quota. There are no charges for public repository usage.
- **Private repositories:** usage counts against the included 2,000 minutes/month and 500 MB artifact storage.
- **Self-hosted runners:** free and unlimited; you pay only for the machine you run it on. Minutes that use self-hosted runners are excluded from the included-guest-minute calculations.
- **When the included private-repository quota is exhausted:** GitHub stops running workflows in private repositories until additional minutes are purchased (or a different payment plan is selected). Artifact storage beyond the 500 MB limit is also billed per GB-month.

The official pages to reference:

- <https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions>
- <https://docs.github.com/en/get-started/learning-about-github/githubs-plans>

**Simple example calculation (this lab):**

Assume this repository is private. Each workflow run on a standard `ubuntu-latest` runner uses roughly:

| Step                           | Approx. minutes |
| ------------------------------ | --------------- |
| Checkout + setup-node + npm ci | ~2              |
| npm audit + tests + build      | ~1              |
| Gitleaks                       | ~1              |
| Semgrep (incl. install)        | ~2              |
| Docker build                   | ~2              |
| Trivy image scan               | ~1              |

Total ≈ **~9 minutes per run**. With the 2,000-minute monthly allowance:

```text
2,000 minutes / 9 minutes per run ≈ 222 runs per month
```

A small startup running CI on a few pull requests a day stays well within the free tier.

**Artifact retention is set to 1 day** because the security reports are only needed temporarily during review — this also keeps the 500 MB artifact storage allowance nearly untouched.

## Running locally

```bash
npm install
npm test
npm run build
npm start
```

The server listens on `http://localhost:3000`:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/users
```
