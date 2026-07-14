# Deployment Record

Last verified: 2026-07-15 (Asia/Seoul)

## Source and Images

- Public repository: `https://github.com/bytonylee/kakao-playmcp`
- Deployment branch: `main`
- Verified revision: `e542375`
- Minwon Run Dockerfile: `minwon-run/Dockerfile`
- My Recall Dockerfile: `naekkeo-recall/Dockerfile`
- Both local images were built as `linux/amd64`, run as the unprivileged `node` user, and reported healthy.

## Verification

- Minwon Run: 42 tests passed; typecheck, build, production dependency audit, Docker health, and MCP smoke check passed.
- My Recall: 50 tests passed; typecheck, build, production dependency audit, Docker health, and MCP smoke check passed.
- Secret scan passed with no credential-like values in tracked or working-tree files.
- Twelve full MCP smoke sequences averaged 216.9 ms for Minwon Run and 174.1 ms for My Recall; the slowest samples were 284.6 ms and 206.2 ms respectively.

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
