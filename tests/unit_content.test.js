/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

describe('getAbsoluteRect', () => {
  let getAbsoluteRect;

  beforeEach(() => {
    // Reset JSDOM document
    document.body.innerHTML = '';

    // Set some default scroll values on the window to ensure scroll logic
    // is NOT what we're testing for absolute offset (since the code doesn't use it).
    // The previous code review complained about scroll offsets, but the actual codebase
    // uses frameElement traversal. We will test both to be safe.
    window.scrollX = 0;
    window.scrollY = 0;

    // Load content.js script into the JSDOM environment
    const code = fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8');

    // We create a script element and append it to the document to execute it within JSDOM.
    // However, getAbsoluteRect is hidden inside an IIFE.
    // Instead of string replacement, let's just evaluate the script in a way we can capture it
    // if possible, OR we extract the function safely.
    // The most robust way without string replace hack is to read the file and extract the function using Regex
    // and then use 'new Function' or 'eval' to create it in our context.

    const funcMatch = code.match(/function getAbsoluteRect\s*\([^)]*\)\s*\{[\s\S]*?\n  \}/);
    if (!funcMatch) {
      throw new Error("Could not find getAbsoluteRect in content.js");
    }
    const funcStr = funcMatch[0];

    // Evaluate the function string into the current scope
    getAbsoluteRect = eval('(' + funcStr + ')');
  });

  test('should return bounding rect for a simple element in the main window', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    // Mock getBoundingClientRect
    el.getBoundingClientRect = jest.fn().mockReturnValue({
      top: 100,
      left: 200,
      height: 50,
      width: 100
    });

    const rect = getAbsoluteRect(el);

    expect(rect).toEqual({
      top: 100,
      left: 200,
      bottom: 150,
      right: 300,
      width: 100,
      height: 50
    });
  });

  test('should calculate absolute rect for an element inside a single iframe', () => {
    // Top Window (the current JSDOM window)
    const topWindow = window;

    // Create an iframe to represent a sub-window
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);

    // Mock iframe's getBoundingClientRect
    iframe.getBoundingClientRect = jest.fn().mockReturnValue({
      top: 50,
      left: 50,
      height: 500,
      width: 500
    });

    // Mock the iframe's content window
    const iframeWindow = {
      parent: topWindow,
      frameElement: iframe
    };

    // Create a mock element inside the iframe
    const mockElement = {
      getBoundingClientRect: jest.fn().mockReturnValue({
        top: 20,
        left: 30,
        height: 10,
        width: 40
      }),
      ownerDocument: {
        defaultView: iframeWindow
      }
    };

    const rect = getAbsoluteRect(mockElement);

    // Expected top = 50 (iframe) + 20 (element) = 70
    // Expected left = 50 (iframe) + 30 (element) = 80
    expect(rect).toEqual({
      top: 70,
      left: 80,
      bottom: 80, // 70 + 10
      right: 120, // 80 + 40
      width: 40,
      height: 10
    });
  });

  test('should calculate absolute rect for an element inside nested iframes', () => {
    const topWindow = window;

    const parentIframe = document.createElement('iframe');
    document.body.appendChild(parentIframe);
    parentIframe.getBoundingClientRect = jest.fn().mockReturnValue({
      top: 100,
      left: 100,
      height: 800,
      width: 800
    });

    const parentIframeWindow = {
      parent: topWindow,
      frameElement: parentIframe
    };

    const nestedIframe = document.createElement('iframe');
    nestedIframe.getBoundingClientRect = jest.fn().mockReturnValue({
      top: 50,
      left: 50,
      height: 400,
      width: 400
    });

    const nestedIframeWindow = {
      parent: parentIframeWindow,
      frameElement: nestedIframe
    };

    const mockElement = {
      getBoundingClientRect: jest.fn().mockReturnValue({
        top: 10,
        left: 15,
        height: 20,
        width: 30
      }),
      ownerDocument: {
        defaultView: nestedIframeWindow
      }
    };

    const rect = getAbsoluteRect(mockElement);

    // Expected top = 100 (parent) + 50 (nested) + 10 (element) = 160
    // Expected left = 100 (parent) + 50 (nested) + 15 (element) = 165
    expect(rect).toEqual({
      top: 160,
      left: 165,
      bottom: 180, // 160 + 20
      right: 195, // 165 + 30
      width: 30,
      height: 20
    });
  });

  test('should break safely if ownerDocument.defaultView is null or missing', () => {
    const mockElement = {
      getBoundingClientRect: jest.fn().mockReturnValue({
        top: 10,
        left: 20,
        height: 30,
        width: 40
      }),
      ownerDocument: {} // missing defaultView
    };

    const rect = getAbsoluteRect(mockElement);

    expect(rect).toEqual({
      top: 10,
      left: 20,
      bottom: 40,
      right: 60,
      width: 40,
      height: 30
    });
  });

  test('should break safely if frameElement is null (e.g. at top level window but parent property altered)', () => {
    const weirdWindow = {
      parent: {}, // parent exists but no frameElement
      frameElement: null
    };

    const mockElement = {
      getBoundingClientRect: jest.fn().mockReturnValue({
        top: 10,
        left: 20,
        height: 30,
        width: 40
      }),
      ownerDocument: {
        defaultView: weirdWindow
      }
    };

    const rect = getAbsoluteRect(mockElement);

    expect(rect).toEqual({
      top: 10,
      left: 20,
      bottom: 40,
      right: 60,
      width: 40,
      height: 30
    });
  });
});
