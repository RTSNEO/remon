<<<<<<< HEAD
<<<<<<< HEAD
# Gemini Auto Browser Agent

An autonomous web browsing agent powered by a local Gemini web session, implemented as a Chromium Manifest V3 Extension.

This extension completely automates generic web browsing tasks (such as searching, navigating, filling out forms, and clicking buttons) by leveraging your active, logged-in `https://gemini.google.com/` session to determine the next intelligent action based on the current page's content.

It operates without consuming any paid APIs, instead relying entirely on DOM scraping and synthetic web interactions within a hidden background tab.

## Features

- **Side Panel Interface**: Control the agent via an accessible Side Panel. Set high-level goals (e.g., "Find software engineering jobs on LinkedIn and apply").
- **Dynamic Action Execution**: The agent automatically scrapes the current active tab's interactive elements and visible text, sends it to Gemini, and executes the requested interaction (click, type, or navigate) via JSON commands.
- **Background Autonomy**: Opens a hidden/pinned Gemini tab if one is not present and coordinates the reasoning loop continuously until the task is complete.
- **Live Action Logs**: Monitor the agent's decision-making process directly in the side panel.

## Installation

Because this is an unpacked extension in active development, you must load it into Chrome manually.

1. Clone this repository.
2. Open Google Chrome (or any Chromium browser).
3. Navigate to `chrome://extensions/` in your address bar.
4. Enable **"Developer mode"** using the toggle switch in the top right corner.
5. Click the **"Load unpacked"** button in the top left.
6. Select the `extension/` folder located inside this repository.

The extension will now appear in your browser.

## Usage

1. **Ensure you are logged into Gemini:** Open a tab and navigate to [https://gemini.google.com/](https://gemini.google.com/) and ensure you are signed in to a Google account.
2. **Open the Side Panel:** Click the extension icon in your browser toolbar to open the "Gemini Auto Browser" side panel.
3. **Navigate to your starting point:** Open the website you want the agent to start its automation on (e.g., a job board).
4. **Enter a Goal:** In the side panel, type your high-level goal in the text area (e.g., "Search for remote QA roles and click the first listing").
5. **Start:** Click the **Start** button. The extension will automatically coordinate with your background Gemini tab and begin interacting with the current page.
6. **Stop:** You can halt the execution loop at any time by clicking the **Stop** button.

## Development & Testing

This project uses Playwright for End-to-End (E2E) testing to verify that the extension loads correctly and the side panel UI functions as expected.

### Running Tests

1. Install dependencies:
   ```bash
   npm install
   ```
2. Install Chromium binaries for Playwright:
   ```bash
   npx playwright install chromium
   ```
3. Run the E2E tests:
   ```bash
   npx playwright test
   ```
   *(Note: If running in a headless CI/CD environment like Linux without an XServer, you may need to use `xvfb-run npx playwright test`)*

## Architecture

- **`manifest.json`**: Manifest V3 configuration requesting `sidePanel`, `tabs`, and `scripting` permissions.
- **`sidepanel.html` & `sidepanel.js`**: User Interface for controlling the agent loop and displaying event logs.
- **`background.js`**: The central orchestrator. It manages the state, handles tab switching, constructs the prompt using page context, and parses the returned JSON actions from Gemini.
- **`content.js` (Target Page)**: Injected into all general websites `<all_urls>`. It maps interactive elements to unique IDs and executes the AI's requested interactions.
- **`gemini.js` (AI Engine)**: Injected only into `https://gemini.google.com/`. It manipulates the DOM to insert prompts and polls for the completed, parsed AI response.
=======
=======
>>>>>>> 42e3a88 (Update README with project details and instructions)
A Chromium extension and agent that automates web browsing tasks using a local Gemini session.

## Features
- Automates navigation and form filling.
- Uses an existing logged-in Gemini web session.
- Avoids direct API usage and quotas.

## Installation
1. Clone this repository.
2. Open Chrome/Edge and go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `extension` folder.

## Usage
- Open a normal browsing window.
- Log in to Gemini in your browser.
- Use the extension popup to start an automation task.

## Development
- Install dependencies:
  ```bash
  npm install
<<<<<<< HEAD
>>>>>>> 42e3a88 (Update README with project details and instructions)
=======
>>>>>>> 42e3a88 (Update README with project details and instructions)
