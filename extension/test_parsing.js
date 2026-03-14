// test_parsing.js
function parseGeminiApiStreamingResponse(rawResponse) {
  let finalText = "";
  let chunkCount = 0;
  let allTextChunks = [];

  try {
    const segments = rawResponse.split(/\r?\n\d+\r?\n|\r?\n\r?\n/);
    for (let segment of segments) {
      segment = segment.trim();
      if (!segment) continue;

      let searchIdx = 0;
      while (searchIdx < segment.length) {
        const jsonStart = segment.indexOf('[', searchIdx);
        const objStart = segment.indexOf('{', searchIdx);
        let start = -1;
        if (jsonStart !== -1 && objStart !== -1) start = Math.min(jsonStart, objStart);
        else if (jsonStart !== -1) start = jsonStart;
        else if (objStart !== -1) start = objStart;

        if (start === -1) break;

        let parsed = null;
        let currentStr = segment.substring(start);
        try {
          parsed = JSON.parse(currentStr);
        } catch (e) {
          const lastBracket = currentStr.lastIndexOf(']');
          const lastBrace = currentStr.lastIndexOf('}');
          const lastMatch = Math.max(lastBracket, lastBrace);
          if (lastMatch !== -1) {
            try {
              const candidate = currentStr.substring(0, lastMatch + 1);
              parsed = JSON.parse(candidate);
              currentStr = candidate;
            } catch (e2) {}
          }
        }

        if (parsed) {
          const toInspect = Array.isArray(parsed) ? parsed : [parsed];
          for (const item of toInspect) {
            let data = null;
            if (Array.isArray(item) && item[0] === "wrb.fr" && item[2]) {
              try { data = JSON.parse(item[2]); } catch (e) {}
            } else {
              data = item;
            }

            if (!data) continue;
            chunkCount++;

            const found = [];
            function collectAllStrings(obj, depth = 0) {
              if (depth > 12) return;
              if (typeof obj === 'string' && obj.length > 0) {
                found.push(obj);
                if (obj.includes('{') || obj.startsWith('[')) {
                  try {
                    const nested = JSON.parse(obj);
                    collectAllStrings(nested, depth + 1);
                  } catch (e) {}
                }
              } else if (Array.isArray(obj)) {
                for (const sub of obj) collectAllStrings(sub, depth + 1);
              } else if (typeof obj === 'object' && obj !== null) {
                for (const key in obj) collectAllStrings(obj[key], depth + 1);
              }
            }
            collectAllStrings(data);

            const jsonLike = found.filter(s => s.includes('"action"'));
            const jsonFallback = found.filter(s => s.includes('{') && s.length > 30);
            const substantial = found.filter(s => s.length > 30);

            const best = jsonLike.length > 0
              ? jsonLike.reduce((a, b) => b.length > a.length ? b : a)
              : jsonFallback.length > 0
                ? jsonFallback.reduce((a, b) => b.length > a.length ? b : a)
                : substantial.length > 0
                  ? substantial.reduce((a, b) => b.length > a.length ? b : a)
                  : '';

            if (best) {
              allTextChunks.push(best);
              if (best.includes('"action"') || best.includes('{')) {
                finalText = best;
              }
            }
          }
          searchIdx = start + currentStr.length;
        } else {
          searchIdx = start + 1;
        }
      }
    }

    if (!finalText && allTextChunks.length > 0) {
      allTextChunks.sort((a, b) => b.length - a.length);
      finalText = allTextChunks[0];
    }
  } catch (error) {
    console.warn("Error in parseGeminiApiStreamingResponse", error);
  }
  return finalText;
}

const rawSnippet = `)]}'\n\n2042\n[["wrb.fr",null,"[null,[\\"c_d1b98aa081cd7098\\",\\"r_6cd76e6e4284e678\\"],null,null,[[\\"rc_f5dd1b8775f75c4a\\",[\\"{\\\\\\"actions\\\\\\": [\\\\n  {\\\\\\"action\\\\\\": \\\\\\\"type\\\\\\\", \\\\\\\"id\\\\\\": 67, \\\\\\\"text\\\\\\": \\\\\\\"ELV Engineer KSA\\\\\\\\n\\\\\\\"},\\\\n  {\\\\\\"action\\\\\\": \\\\\\\"click\\\\\\\", \\\\\\\"id\\\\\\": 14}\\\\n]}\\\"],[null,null,null,null,null,null,null,0],null,null,null,null,null,null,null,null,null,null,0,null,null,null,null,null,null,null,null,null,null,null,null,12] ] ] ] ] ]" ]]`;

const result = parseGeminiApiStreamingResponse(rawSnippet);
console.log("--- TEST RESULT ---");
console.log(result);
if (result.includes('"action"')) {
    console.log("SUCCESS");
} else {
    console.log("FAILURE");
    process.exit(1);
}
