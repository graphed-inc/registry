# clients/

Per-client configuration for plugins lives here, one directory per plugin:

```
clients/seo/client.config.json
```

Plugin code resolves these files relative to the project root (the directory
containing `graphed.yaml`) — see `projectRoot()` in `packages/core`. Values
here are client identity (brand voice, CMS field mapping, metric schemas),
not credentials: API keys and tokens belong in `.env` locally and
`graphed secrets set` in cloud, never in this directory.
