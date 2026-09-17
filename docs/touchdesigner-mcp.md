# TouchDesigner MCP (development only)

The TouchDesigner backend redesign (`touchdesigner-backend-redesign.md`,
Phase 0) calls for an MCP so an agent can author and inspect the engine
network. This repo is configured for `8beeeaaat/touchdesigner-mcp`
(<https://github.com/8beeeaaat/touchdesigner-mcp>), the route Derivative's
community post "Claude Code + MCP_server + Touchdesigner (the easy way)"
describes.

It is a local development tool and never ships with the web app. Keep its
TouchDesigner Web Server DAT bound to 127.0.0.1; a blank Local Address exposes
the server on every interface.

## One-time setup

1. Use TouchDesigner **2025.33070 or newer**. Non-commercial is fine. That
   release added the Web Server DAT's Local Address setting used to restrict
   control to localhost. See the [release notes](https://derivative.ca/release/202533070/75035).
2. In the TouchDesigner project you want to drive (for example
   `touchdesigner/BassAuraPhase1.2.toe`, or a fresh project), import the
   `mcp_webserver_base.tox` that ships with the MCP server, placed directly
   under the project: `/project1/mcp_webserver_base`. It starts a Web Server
   DAT on port 9981. Set that DAT's **Local Address** to `127.0.0.1` and
   restart it before using the MCP; verify it is not listening on `*`.
3. Run `npm ci` from the repo root to install the lockfile's exact packages and
   verify their integrity. The MCP server is pinned to version `2.0.0`.
4. Start Claude Code from the repo root so it loads `.mcp.json`. The launcher
   runs `node ./node_modules/touchdesigner-mcp-server/dist/cli.js`, using only
   the installed local package. If it is missing, startup fails instead of
   downloading a replacement; run `npm ci` before trying again. Approve the
   project MCP server when Claude Code asks on first use. If TouchDesigner is
   not on the default host/port, append `--host` / `--port` to the `args` in
   `.mcp.json` after the CLI path.

## Working session

- Keep TouchDesigner open with the project loaded while working.
- After updating the MCP server or the `.tox`, restart both TouchDesigner
  and Claude Code so the new code is loaded.
- The `.tox` locates its Python modules with relative paths; do not move the
  server's files around after installing.

## What the agent can then do

Create and wire operators, set parameters, read and write DATs, run Python
in the project, and check for errors, which is what the redesign's Phase 1
(WebSocket bridge on port 9980 plus the Body Echo session) needs.
