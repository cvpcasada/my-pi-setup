# my pi setup

My global [pi](https://github.com/earendil-works/pi) setup. The repo lives directly at `~/.pi/agent` so pi discovers its resources without symlinks or extra settings.

## Included

### Extensions

- `ask-user`: multiple-choice prompts
- `background-terminals`: long-running process management
- `compact-tools`: every tool call and background terminal exit renders as one line (icon, args, status, chevron); click or Ctrl+O expands
- `copy-all`: copy session content
- `firecrawl-search`: web search, scraping, and crawling
- `model-info`: model and context information
- `pi-diff`: Pierre-themed inline rendering for edit and write diffs

### Skills

Only skills used by included extensions are tracked:

- `background-terminals`

### Themes

- `vesper`

## Install

See [SETUP.md](SETUP.md).

## Private files

Pi's credentials, settings, sessions, model configuration, extension preferences, runtime data, and `.env` are ignored. `.env.example` documents the environment variables used by extensions.

## License

This setup is licensed under the [MIT License](LICENSE). The included `pi-diff` code retains its upstream MIT license and attribution.
