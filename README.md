# my pi setup

My global [pi](https://github.com/earendil-works/pi) setup. The repo lives directly at `~/.pi/agent` so pi discovers its resources without symlinks or extra settings.

## Included

### Extensions

- `ask-user`: multiple-choice prompts
- `background-terminals`: long-running process management
- `copy-all`: copy session content
- `firecrawl-search`: web search, scraping, and crawling
- `model-info`: model and context information
- `pi-diff`: Pierre-themed inline rendering for edit and write diffs
- `subagents`: delegated agents using pi, Claude Code, or Codex
- `workflows`: multi-agent workflow orchestration

### Skills

Only skills used by included extensions are tracked:

- `background-terminals`
- `subagents`

### Themes

- `vesper`

## Install

See [SETUP.md](SETUP.md).

## Private files

Pi's credentials, settings, sessions, model configuration, extension preferences, runtime data, and `.env` are ignored. `.env.example` documents the environment variables used by extensions.

`pi-diff` is based on [tanvesh01/pierre-diffs](https://github.com/tanvesh01/pierre-diffs) and is included under its MIT license.
