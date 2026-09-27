# datafuel-js

JavaScript packages for the [DataFuel](https://datafuel.ai) scraping API.

| Package                         | What it is                                                         | Install                     |
| ------------------------------- | ------------------------------------------------------------------ | --------------------------- |
| [`@datafuel/sdk`](packages/sdk) | TypeScript client for the API. No runtime dependencies.            | `npm install @datafuel/sdk` |
| [`@datafuel/mcp`](packages/mcp) | Sets up the DataFuel MCP server in Claude Code, Cursor and others. | `npx -y @datafuel/mcp init` |

## Development

npm workspaces, Node 20.3 or later.

```bash
npm ci
npm run check   # lint, format:check, typecheck, test in every package
npm run build
```

`npm run test:live` runs the SDK against the real API and needs `DATAFUEL_API_KEY`.

## Release

Push a tag from a commit on `main`; `.github/workflows/release.yml` checks and publishes the package.

| Tag              | Publishes       |
| ---------------- | --------------- |
| `sdk-v<version>` | `@datafuel/sdk` |
| `mcp-v<version>` | `@datafuel/mcp` |

- The tag version must match `version` in that package's `package.json`.
- Release the SDK first: an `mcp-v*` tag fails unless a published `@datafuel/sdk` satisfies the mcp dependency range.
- A tag on a commit that is not on `main` fails. A version already on npm is skipped, so re-running is safe.
- A prerelease version (`1.2.0-rc.1`) is published under the `next` dist-tag.

## License

MIT, see [LICENSE](LICENSE).
