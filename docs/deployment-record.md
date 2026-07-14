# Deployment Record

Last verified: 2026-07-15 (Asia/Seoul)

## Source and Images

- Public repository: `https://github.com/bytonylee/kakao-playmcp`
- Deployment branch: `main`
- Verified source: current `main` after the security-hardening update
- Minwon Run Dockerfile: `minwon-run/Dockerfile`
- My Recall Dockerfile: `naekkeo-recall/Dockerfile`
- Both local images were built as `linux/amd64`, run as the unprivileged `node` user, use root-owned read-only application files, and reported healthy with read-only root filesystems, all capabilities dropped, and `no-new-privileges` enabled.

## Verification

- Minwon Run: 53 tests passed; typecheck, build, production dependency audit, Docker health, and local/external MCP smoke checks passed.
- My Recall: 59 tests passed; typecheck, build, production dependency audit, Docker health, and local/external MCP smoke checks passed.
- Secret scan passed across Git history, tracked files, and working-tree files.
- Security regression checks confirm JSON-RPC batches return 400, untrusted browser origins return 403, redirects are disabled, validated request concurrency is bounded, slow request reads are timed out, and upstream bodies, fields, and record counts are capped. Per-client rate limiting remains a trusted-gateway deployment control rather than a process-wide counter.
- Twelve full MCP smoke sequences averaged 144.2 ms for Minwon Run and 113.4 ms for My Recall; the slowest samples were 281.4 ms and 220.4 ms respectively.

## External Registration

- Minwon Run is saved in PlayMCP as an online draft with three tools.
- My Recall registration data and four-tool connection have been verified; final draft save requires selecting the generated app icon in the browser.
- PlayMCP in KC authentication succeeded, but the portal returned its contest-registration-expired state and prevented creation of new KC servers.
- Temporary HTTPS endpoints are being used only to verify PlayMCP connectivity while KC registration is unavailable. They are not production endpoints and must not be submitted as KC endpoints.

## Pending External Gates

- Select the 600x600 My Recall icon and save the PlayMCP draft.
- Obtain supported KC endpoints if the contest portal is reopened or Kakao grants an exception.
- Request PlayMCP review, wait for approval, switch both services to full public, and capture the resulting detail URLs.
- Submit the Kakao form only after the public-state statements and URLs are true.
