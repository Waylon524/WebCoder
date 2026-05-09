# WebCoder

WebCoder is a local-first website manager for simple HTML projects. It runs in the browser, connects to a local workspace folder, previews each website, and lets you update a project's `index.html` with an OpenAI-compatible chat API.

## Features

- Connect a local workspace folder with the File System Access API.
- Detect first-level subfolders that contain an `index.html` file.
- Create, import, rename, delete, save, export, and undo website projects.
- Preview local HTML projects in desktop and mobile sizes.
- Load local project assets in preview, including relative CSS, images, scripts, fonts, and CSS `url(...)` resources.
- Restore the last connected workspace after browser restart when permission is still available.
- Configure an OpenAI-compatible `base URL`, model, and API key in the app settings.

## Browser Support

WebCoder depends on the File System Access API, so use a Chromium-based browser such as:

- Google Chrome
- Microsoft Edge

Other browsers may load the interface but will not be able to connect and write to local folders.

## Quick Start

Clone the repository:

```bash
git clone https://github.com/Waylon524/WebCoder.git
cd WebCoder
```

Start any static file server from the repository root:

```bash
python -m http.server 4174 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:4174/
```

## Workspace Format

Choose a folder that contains one subfolder per website project:

```text
My Sites/
  Portfolio/
    index.html
    styles.css
    assets/
  Product Page/
    index.html
```

WebCoder treats each first-level folder with an `index.html` file as a project. Folders without `index.html` are ignored.

## AI Settings

Open **Settings** inside the app and provide:

- `Base URL`: an OpenAI-compatible API endpoint, for example `https://api.openai.com/v1`
- `Model`: the chat model to use
- `API Key`: your API key

The settings are stored in your browser's local storage. Project files stay on your machine unless you send page content to the configured AI endpoint.

## Development

This is a dependency-free static web app:

```text
index.html
styles.css
app.js
assets/
```

Useful checks:

```bash
node --check app.js
```

## Security And Privacy

- WebCoder only receives access to folders you explicitly select in the browser picker.
- Browser permission may need to be granted again after restarting the browser.
- API keys are stored locally in the browser and are not committed to this repository.
- Prompts sent to an AI endpoint include the current project's HTML so the model can edit it.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
