# Setup

## Fresh install

Clone the repo directly into pi's global agent directory:

```sh
git clone git@github.com:cvpcasada/my-pi-setup.git ~/.pi/agent
cd ~/.pi/agent
npm install
for dir in extensions/*; do
  [ -f "$dir/package.json" ] && npm --prefix "$dir" install
done
```

Pi loads the extensions, extension-related skills, and theme from their conventional directories on its next start.

## Firecrawl

The `firecrawl-search` extension needs a [Firecrawl API key](https://www.firecrawl.dev/):

```sh
cp ~/.pi/agent/.env.example ~/.pi/agent/.env
```

Replace the placeholder in `.env` with your key. `.env` is ignored by git.

## Theme

Choose `vesper` in `/settings`, or add it to `~/.pi/agent/settings.json` while keeping your other settings:

```json
{
  "theme": "vesper"
}
```

## Existing pi install

Back up `~/.pi/agent` before cloning. Restore private files such as `auth.json`, `settings.json`, and `.env` after the clone. Do not commit them.
