# Traxy browser extension

## Load it in Chrome

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this `extension` folder.
3. Open the Traxy extension popup, connect with your Traxy account, and leave the app URL set to `https://mcloonea.github.io/traxy`.
4. On a site where you want the shortcut, enable **Enable on this site**. Chrome will ask for access to that site.
5. In a text field, type `//` quickly to open the Traxy panel. Select any relevant word tracks or tags, add instructions, and continue. Traxy opens the chat and submits the draft automatically.

The extension asks for site access only after you enable it for that site. It uses the signed-in account to read your private word tracks and tags. Your Supabase session is stored in Chrome extension storage and handed to the Traxy page through the URL fragment; the chat page removes that fragment immediately after reading it.

The project is a static site. GitHub Pages publishes the root of the `main` branch.
