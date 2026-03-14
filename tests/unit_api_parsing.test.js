const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('parseGeminiApiStreamingResponse', () => {
  let context;
  let parseGeminiApiStreamingResponse;

  beforeAll(() => {
    const code = fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8');

    // Mock chrome API
    const chrome = {
      sidePanel: { setPanelBehavior: jest.fn().mockReturnValue({ catch: jest.fn() }) },
      offscreen: {
        hasDocument: jest.fn().mockResolvedValue(false),
        createDocument: jest.fn().mockResolvedValue({}),
        closeDocument: jest.fn().mockResolvedValue({}),
      },
      runtime: {
        onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
        sendMessage: jest.fn().mockReturnValue({ catch: jest.fn() }),
        lastError: null,
      },
      storage: {
        local: {
          set: jest.fn(),
          get: jest.fn(),
        },
      },
      tabs: {
        query: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        get: jest.fn().mockResolvedValue({}),
        sendMessage: jest.fn(),
        captureVisibleTab: jest.fn().mockResolvedValue(''),
        reload: jest.fn().mockResolvedValue({}),
      },
      scripting: {
        executeScript: jest.fn().mockResolvedValue([]),
      },
    };

    context = {
      chrome,
      console: {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      },
      setTimeout: jest.fn(),
      clearTimeout: jest.fn(),
      setInterval: jest.fn(),
      clearInterval: jest.fn(),
      fetch: jest.fn(),
      URL: global.URL,
      URLSearchParams: global.URLSearchParams,
      Math: global.Math,
      Promise: global.Promise,
      JSON: global.JSON,
    };

    vm.createContext(context);
    vm.runInContext(code, context);
    parseGeminiApiStreamingResponse = context.parseGeminiApiStreamingResponse;
  });

  test('should return empty string for empty input', () => {
    expect(parseGeminiApiStreamingResponse('')).toBe('');
  });

  test('should parse a simple JSON object string containing "action"', () => {
    const input = '{"action": "click", "id": 1}';
    expect(JSON.parse(parseGeminiApiStreamingResponse(input))).toEqual({action: "click", id: 1});
  });

  test('should parse a JSON array with action object', () => {
    const input = '[{"action": "click", "id": 1}]';
    expect(JSON.parse(parseGeminiApiStreamingResponse(input))).toEqual({action: "click", id: 1});
  });

  test('should extract action JSON from Gemini stream envelope format (e.g. lengths)', () => {
    const actionJson = '{"action": "click", "id": 2}';
    const input = `123\r\n${actionJson}\r\n\r\n45\r\n[some other text]`;
    expect(JSON.parse(parseGeminiApiStreamingResponse(input))).toEqual({action: "click", id: 2});
  });

  test('should parse wrb.fr payload with nested JSON string', () => {
    const nestedJson = '{"action": "navigate", "url": "https://example.com"}';
    const escapedNestedJson = JSON.stringify(nestedJson); // Stringify the string to escape quotes
    const input = `[["wrb.fr", "some_id", ${escapedNestedJson}]]`;
    expect(JSON.parse(parseGeminiApiStreamingResponse(input))).toEqual({action: "navigate", url: "https://example.com"});
  });

  test('should return the longest substantial string if no "action" is found but large JSON-like string is present', () => {
      const longJson = '{"something": "else", "data": "this is a long string that is longer than 30 characters"}';
      const input = `123\r\n${longJson}\r\n\r\n`;
      expect(JSON.parse(parseGeminiApiStreamingResponse(input))).toEqual(JSON.parse(longJson));
  });

  test('should prefer string containing "action" over a longer substantial string', () => {
      const actionJson = '{"action": "click", "id": 5}'; // shorter than longJson
      const longJson = '{"something": "else", "data": "this is a very long string that is longer than 30 characters"}';
      const input = `[${longJson}, ${actionJson}]`;
      expect(JSON.parse(parseGeminiApiStreamingResponse(input))).toEqual({action: "click", id: 5});
  });

  test('should handle malformed JSON gracefully and recover', () => {
    const actionJson = '{"action": "click", "id": 3}';
    // The malformed part before it shouldn't crash the parser, and it should find the valid one.
    // Wait, the function looks for JSON boundaries. If it finds a bracket and tries to parse but fails,
    // it tries to trim from the end. If it completely fails, it advances searchIdx by 1.
    const input = `{"broken": true, \n {"action": "click", "id": 3}`;
    expect(JSON.parse(parseGeminiApiStreamingResponse(input))).toEqual({action: "click", id: 3});
  });
});
