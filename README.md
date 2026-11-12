# sts-blueapi-audit-pack-tool

A small web tool to pull the correct audit pack PDF from the Blue API.

Enter a **proposal ID** and a **document version**; the tool looks up the sign
sessions, finds the one matching the given document version, resolves its
`SessionRef`, and downloads the corresponding audit pack PDF.

## How it works

1. `GET /Sessions?proposalId={ID}` on the Blue API returns a list of
   `SignSessions`.
2. The tool selects the session whose `DocumentVersion` matches the version you
   entered, and reads its `SessionRef`.
3. `GET /GetAudit/{sessionRef}?sessionRef={sessionRef}` is called and the PDF is
   streamed back to your browser as a download.

A small Node/Express backend proxies these calls. A backend is required because
the Blue API is on a different origin (browser CORS would otherwise block the
requests) and because the audit pack is a binary download.

## Running

```bash
npm install
cp .env.example .env   # adjust values as needed
npm start
```

Then open http://localhost:3000.

## Configuration

Set via environment variables (or a local `.env` file):

| Variable            | Default                                  | Purpose                                              |
| ------------------- | ---------------------------------------- | ---------------------------------------------------- |
| `PORT`              | `3000`                                   | Port the tool listens on.                            |
| `BLUE_API_BASE_URL` | `https://sign.bluemotorfinance.co.uk`    | Base URL of the Blue API (no trailing slash).        |
| `BLUE_API_COOKIE`   | _(empty)_                                | Optional `Cookie` header forwarded to the Blue API.  |
| `BLUE_API_AUTH`     | _(empty)_                                | Optional `Authorization` header forwarded to the API.|

No credentials are hardcoded. If the Blue API requires authentication, provide
it through `BLUE_API_COOKIE` and/or `BLUE_API_AUTH`.

## Behaviour / edge cases

- **No matching version**: returns an error and lists the versions that are
  available for that proposal.
- **Multiple sessions with the same version**: returns an error rather than
  guessing, since a single audit pack cannot be determined.
- **"Look up versions"** button: optional helper that lists the available
  `DocumentVersion` / `SessionRef` pairs for a proposal so you can pick one.
