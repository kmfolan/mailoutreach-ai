# MailOutreach HVAC — Claude Desktop connector

An MCP server that lets **Claude Desktop** run the HVAC lead-gen pipeline as
native tools, talking to your deployed MailOutreach server. Keys stay on the
server; Desktop only needs the URL + your app login.

## Tools it adds

| Tool | What it does |
|---|---|
| `start_hvac_run` | Start a job (`mode`, `target`) → returns a job id |
| `hvac_run_status` | Poll a job's progress |
| `download_hvac_csv` | Save the finished CSV to disk |

## Prerequisites

1. The MailOutreach server is **deployed and reachable** (e.g. your droplet),
   with `GOOGLE_MAPS_API_KEY` and `APOLLO_API_KEY` set in its environment.
   (Locally is fine too: `MAILOUTREACH_BASE_URL=http://localhost:4021`.)
2. Node 18+ on the machine running Claude Desktop. No `npm install` needed.

## Configure Claude Desktop

Edit the config file:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add this server (use the **absolute path** to `hvac-mcp.mjs`):

```json
{
  "mcpServers": {
    "mailoutreach-hvac": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/mailoutreach-ai/mcp/hvac-mcp.mjs"],
      "env": {
        "MAILOUTREACH_BASE_URL": "https://your-droplet.example.com",
        "MAILOUTREACH_USERNAME": "admin",
        "MAILOUTREACH_PASSWORD": "your-app-password"
      }
    }
  }
}
```

Restart Claude Desktop. The three tools appear under the connector.

> The password sits in your **local** Desktop config (same as any SMTP/app
> password on your machine) — it is never sent to the model or into chat.

## Use it

In Claude Desktop, just ask:

> "Start a comprehensive HVAC run for 5000 leads."
> → then "check the status of that job"
> → then "download the CSV" (saved to your home folder by default)

Import the resulting CSV at **contacts.google.com → Import**.

## Notes

- A 5,000-lead run takes many minutes; that's why it's an async job you poll,
  not a single blocking call.
- `mode`: `standard` · `comprehensive` · `maps-only` · `apollo-only`
  (see `docs/HVAC_LEADS.md`).
- Same server, same engine as the web API — so a job you start here is
  identical to one started from Claude on the web.
