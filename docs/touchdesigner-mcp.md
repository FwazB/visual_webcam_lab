# TouchDesigner developer MCP is on hold

Body Synth's website, Fuzz scene and Projection Mapping scene run independently of the developer MCP. Skip the MCP when setting up these projects.

The previously recommended component starts an unauthenticated control service as soon as it is imported. A client that can reach it could run Python with the TouchDesigner user's permissions. Keep the component disabled. A future setup needs to start inactive, bind to loopback and authenticate clients before accepting control requests.

## Disable an existing setup

1. If the component is already loaded in TouchDesigner, turn off **Active** on the developer component `mcp_webserver_base`. Save your local project with the component inactive. For an older project that might start the component when opened, disconnect the machine from the network before opening it to disable the component.
2. If you registered a `touchdesigner` MCP server in your own client settings, remove that entry and restart the client. Updating Body Synth alone cannot stop a component already running inside TouchDesigner.
3. On macOS, check for a local listener with the following command. An empty result means no TCP service is listening on the old default port. If you configured a different port, check that port instead.

   ```sh
   lsof -nP -iTCP:9981 -sTCP:LISTEN
   ```
